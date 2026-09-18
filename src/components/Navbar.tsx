import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/materials', label: 'Materials' },
  { to: '/training', label: 'AI Training' },
  { to: '/recommendations', label: 'iGOT' },
  { to: '/settings', label: 'Settings' },
];

export default function Navbar() {
  const { session, profile, signOut } = useAuth();

  return (
    <nav className="glass sticky top-0 z-40 border-x-0 border-t-0 shadow-md">
      <div className="container mx-auto px-4 py-3 flex flex-wrap sm:flex-nowrap justify-between items-center gap-2">
        <Link to="/" className="text-xl font-bold text-white tracking-tight shrink-0">
          COMPASS <span className="text-gradient-brand">Platform</span>
        </Link>

        {/* Scrollable on phones — six links + brand + user block do not fit
            390px, and a scroll row beats a hamburger for a demo app. */}
        <div className="order-3 sm:order-none w-full sm:w-auto flex items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `px-2.5 py-1.5 sm:px-3 sm:py-2 rounded text-xs sm:text-sm whitespace-nowrap transition ${
                  isActive
                    ? 'bg-blue-600/90 text-white shadow-[0_0_14px_rgba(124,58,237,0.45)]'
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          {profile?.role === 'admin' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `px-2.5 py-1.5 sm:px-3 sm:py-2 rounded text-xs sm:text-sm whitespace-nowrap transition ${
                  isActive ? 'bg-amber-500/20 text-amber-300' : 'text-amber-300/80 hover:text-amber-300'
                }`
              }
            >
              Admin
            </NavLink>
          )}
        </div>

        <div className="flex items-center gap-3">
          {session && profile ? (
            <>
              <div className="text-right hidden sm:block">
                <p className="text-sm text-white leading-tight">{profile.full_name ?? profile.email}</p>
                <p className="text-xs text-gray-400 leading-tight">
                  {profile.designation ?? 'Officer'} · {profile.role}
                </p>
              </div>
              <button
                onClick={() => void signOut()}
                className="text-sm text-gray-300 hover:text-white border border-gray-600 hover:border-gray-400 hover:bg-white/5 px-3 py-1.5 rounded transition"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="btn-gradient px-4 py-2 rounded text-white text-sm"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
