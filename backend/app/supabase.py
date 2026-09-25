"""A narrow PostgREST client, bound to one officer's access token.

Deliberately hand-rolled rather than wrapped in the official Python SDK: this
service needs six calls, and talking to PostgREST directly keeps the exact
status codes the UI's messages depend on (PGRST116 means "no row", 42501 means
RLS refused). It also makes the security property obvious in one place — every
request here carries the officer's own token, so RLS decides what may be read
and written. No service-role key exists anywhere in this service.
"""

from __future__ import annotations

from typing import Any

import httpx

from .config import Settings


class PostgrestError(Exception):
    """A database call PostgREST refused."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status: int | None = None,
        details: str | None = None,
        hint: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.details = details
        self.hint = hint

    @property
    def is_missing_row(self) -> bool:
        """PostgREST's "expected one row, found none" code."""
        return self.code == "PGRST116"

    @property
    def is_unknown_column(self) -> bool:
        """True when the write named a column this database does not have.

        PGRST204 is PostgREST's schema cache refusing it and 42703 is Postgres
        itself — both are what an unapplied migration looks like to a deploy
        that shipped the code first. Callers still check the message for the
        column they care about, because the code alone does not say which one.
        """
        return self.code in {"PGRST204", "42703"}


class Postgrest:
    """PostgREST over HTTP, authorised by the current officer."""

    def __init__(self, settings: Settings, access_token: str, timeout: float = 30.0) -> None:
        self._settings = settings
        self._token = access_token
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10.0))

    async def __aenter__(self) -> Postgrest:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    def _headers(self, *, prefer: str | None = None, single: bool = False) -> dict[str, str]:
        headers = {
            "apikey": self._settings.supabase_anon_key,
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }
        if single:
            # Asks PostgREST for one object instead of an array; with no match
            # it answers PGRST116 rather than an empty list.
            headers["Accept"] = "application/vnd.pgrst.object+json"
        if prefer:
            headers["Prefer"] = prefer
        return headers

    @staticmethod
    def _parse_error(res: httpx.Response) -> PostgrestError:
        body: Any = None
        try:
            body = res.json()
        except ValueError:
            body = None
        if not isinstance(body, dict):
            body = {}
        return PostgrestError(
            str(body.get("message") or f"the database returned HTTP {res.status_code}"),
            code=body.get("code"),
            status=res.status_code,
            details=body.get("details"),
            hint=body.get("hint"),
        )

    async def _send(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json_body: Any = None,
        prefer: str | None = None,
        single: bool = False,
    ) -> httpx.Response:
        url = f"{self._settings.rest_url}/{path.lstrip('/')}"
        try:
            res = await self._client.request(
                method,
                url,
                params=params,
                json=json_body,
                headers=self._headers(prefer=prefer, single=single),
            )
        except httpx.HTTPError as err:
            # A database this service cannot reach is not the officer's fault,
            # but the message still has to say what happened.
            raise PostgrestError(f"could not reach the database ({err})") from err

        if res.status_code >= 400:
            raise self._parse_error(res)
        return res

    @staticmethod
    def _eq(filters: dict[str, Any]) -> dict[str, str]:
        return {key: f"eq.{value}" for key, value in filters.items()}

    async def select_one(
        self, table: str, columns: str, filters: dict[str, Any]
    ) -> dict[str, Any] | None:
        """One row, or None when nothing matched. RLS applies."""
        params = self._eq(filters)
        params["select"] = columns
        try:
            res = await self._send("GET", table, params=params, single=True)
        except PostgrestError as err:
            if err.is_missing_row:
                return None
            raise
        data = res.json()
        return data if isinstance(data, dict) else None

    async def select_in(
        self, table: str, columns: str, column: str, values: list[str]
    ) -> list[dict[str, Any]]:
        """Rows where `column` is one of `values`. RLS applies."""
        joined = ",".join(values)
        res = await self._send(
            "GET", table, params={"select": columns, column: f"in.({joined})"}
        )
        data = res.json()
        return data if isinstance(data, list) else []

    async def insert_one(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        """Insert and return the stored row (`select().single()` in supabase-js)."""
        res = await self._send(
            "POST", table, json_body=row, prefer="return=representation", single=True
        )
        data = res.json()
        if not isinstance(data, dict):
            raise PostgrestError("the insert did not return the created row")
        return data

    async def insert(self, table: str, rows: list[dict[str, Any]]) -> None:
        await self._send("POST", table, json_body=rows, prefer="return=minimal")

    async def delete(self, table: str, filters: dict[str, Any]) -> None:
        await self._send("DELETE", table, params=self._eq(filters), prefer="return=minimal")

    async def patch(self, table: str, values: dict[str, Any], filters: dict[str, Any]) -> None:
        await self._send(
            "PATCH",
            table,
            params=self._eq(filters),
            json_body=values,
            prefer="return=minimal",
        )

    async def rpc(self, function: str, args: dict[str, Any]) -> Any:
        res = await self._send("POST", f"rpc/{function}", json_body=args)
        return res.json()
