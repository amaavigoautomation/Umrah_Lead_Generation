import React, { useState } from 'react';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  Database,
  KeyRound,
  AlertCircle,
  Shield,
  Sparkles,
} from 'lucide-react';
import { Umrah360Logo } from './Umrah360Logo';
import { signIn, requestPasswordReset, friendlyAuthError } from '../services/authService';

interface LoginViewProps {
  isFirebaseActive: boolean;
  initialError?: string | null;
}

export const LoginView: React.FC<LoginViewProps> = ({ isFirebaseActive, initialError }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // On success, onAuthStateChanged in App takes over; nothing to call here.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const email = identifier.trim();
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setIsLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(friendlyAuthError(err));
      setIsLoading(false);
    }
  };

  const handleForgot = async () => {
    setError(null);
    setInfo(null);
    const email = identifier.trim();
    if (!email) {
      setError('Enter your email above first, then click "Forgot password".');
      return;
    }
    try {
      await requestPasswordReset(email);
    } catch {
      // Same message either way, so we never reveal which emails have accounts.
    }
    setInfo('If an account exists for that email, a reset link has been sent.');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden selection:bg-orange-500/20 selection:text-orange-900">
      {/* Soft orange ambient ambient glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center mb-2">
            <Umrah360Logo size="lg" />
          </div>
          <p className="text-xs text-slate-600 max-w-sm mx-auto font-medium">
            Autonomous Inbound Pilgrimage Capture, Cold Outreach & Omnichannel Lead Engine
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <KeyRound className="w-4 h-4 text-orange-500" />
              <h2 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">Account Sign In</h2>
            </div>
            <div className="flex items-center space-x-1.5 text-[11px] text-slate-500 font-medium">
              <Database className="w-3.5 h-3.5 text-orange-500" />
              <span>{isFirebaseActive ? 'Firestore Live' : 'Database Ready'}</span>
            </div>
          </div>

          {info && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs">
              {info}
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="text-slate-700 block mb-1.5 font-bold">Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="email"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 font-medium transition"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-slate-700 block mb-1.5 font-bold">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-10 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 font-medium transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-xs transition flex items-center justify-center space-x-2 shadow-md shadow-orange-500/20 disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <span>Verifying credentials...</span>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={handleForgot}
              className="text-[11px] font-bold text-orange-600 hover:text-orange-700"
            >
              Forgot password?
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
