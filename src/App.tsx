import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import SetupRequired from './components/SetupRequired';
import { isSupabaseConfigured } from './lib/supabase';
import { AuthProvider } from './context/AuthContext';
import Admin from './pages/Admin';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Materials from './pages/Materials';
import NotFound from './pages/NotFound';
import Quiz from './pages/Quiz';
import ResetPassword from './pages/ResetPassword';
import Settings from './pages/Settings';
import Recommendations from './pages/Recommendations';
import Training from './pages/Training';

export default function App() {
  if (!isSupabaseConfigured) {
    return <SetupRequired />;
  }
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen text-white">
          <Navbar />
          <main className="container mx-auto p-8">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/materials"
                element={
                  <ProtectedRoute>
                    <Materials />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/quiz/:quizId"
                element={
                  <ProtectedRoute>
                    <Quiz />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/training"
                element={
                  <ProtectedRoute>
                    <Training />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/recommendations"
                element={
                  <ProtectedRoute>
                    <Recommendations />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <Admin />
                  </ProtectedRoute>
                }
              />
              {/* Anything else — a stale bookmark, a typo — used to render an
                  empty <main> with no clue what happened. */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
