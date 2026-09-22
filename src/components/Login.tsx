import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Lock, User, Terminal, Calendar, Clock, ArrowRight, Sparkles, Play, Hotel, ChefHat } from 'lucide-react';
import { USER_ACCOUNTS } from '../data';
import { login as apiLogin } from '../api/auth';

interface LoginProps {
  onLogin: (username: string, role?: string) => void;
  onOpenLaunchAnimation?: () => void;
  onOpenCustomerDisplay?: () => void;
  onOpenKitchenDisplay?: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin, onOpenLaunchAnimation, onOpenCustomerDisplay, onOpenKitchenDisplay }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    try {
      // Primary: Authenticate against PostgreSQL API backend
      const res = await apiLogin(trimmedUsername, trimmedPassword);
      onLogin(res.username, res.role);
    } catch (err: any) {
      // Fallback check against in-memory user accounts if API error
      const matchedAccount = USER_ACCOUNTS.find(
        (acc) =>
          acc.username.trim().toLowerCase() === trimmedUsername.toLowerCase() &&
          acc.accessCode.trim() === trimmedPassword
      );

      if (matchedAccount) {
        onLogin(matchedAccount.username);
      } else {
        setError(err.message || 'Invalid operator credentials. Access Denied.');
      }
    }
  };



  const formattedDate = currentTime.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const formattedTime = currentTime.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });



  return (
    <div className="min-h-screen bg-cream flex flex-col justify-between p-4 md:p-8 font-sans selection:bg-secondary selection:text-primary">
      {/* Top Status Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-secondary/40 pb-4 text-xs font-mono tracking-wider text-charcoal/60 uppercase">
        <div className="flex items-center gap-2 mb-2 sm:mb-0">
          <Terminal size={14} className="text-primary animate-pulse" />
          <span>STATION-FD-01 // FRONT DESK CORE</span>
        </div>
        <div className="flex items-center gap-4">
          {onOpenKitchenDisplay && (
            <button
              onClick={onOpenKitchenDisplay}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 border border-amber-500/30 transition cursor-pointer font-bold text-[11px]"
              title="Open Kitchen Display (no login required)"
            >
              <ChefHat size={12} className="text-amber-600" />
              <span>Kitchen Display</span>
            </button>
          )}
          {onOpenCustomerDisplay && (
            <button
              onClick={onOpenCustomerDisplay}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-800 border border-emerald-600/30 transition cursor-pointer font-bold text-[11px]"
              title="Open Lobby Room Availability Display"
            >
              <Hotel size={12} className="text-emerald-600" />
              <span>Lobby Display</span>
            </button>
          )}
          {onOpenLaunchAnimation && (
            <button
              onClick={onOpenLaunchAnimation}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20 transition cursor-pointer font-bold text-[11px]"
            >
              <Sparkles size={12} className="text-amber-500" />
              <span>Launch Animation</span>
            </button>
          )}
          <span className="flex items-center gap-1.5">
            <Calendar size={13} /> {formattedDate}
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-primary">
            <Clock size={13} /> {formattedTime}
          </span>
        </div>
      </div>

      {/* Main Login Screen */}
      <div className="flex-1 flex items-center justify-center py-8 max-w-xl mx-auto w-full">
        
        {/* Main Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-md bg-white border border-secondary shadow-xl rounded-2xl p-6 md:p-8 relative"
        >
          {/* Brand Logo & Header */}
          <div className="text-center mb-6">
            <div
              onClick={onOpenLaunchAnimation}
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/95 text-white mb-4 border border-primary/20 p-2.5 shadow-lg shadow-primary/15 cursor-pointer hover:scale-105 transition group"
              title="Click to view brand launch animation"
            >
              <img src="/sedona-logo.png" alt="Sedona Court" className="w-full h-full object-contain filter drop-shadow-sm group-hover:scale-105 transition" />
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-primary leading-tight">
              SEDONA COURT
            </h1>
            <p className="text-[10px] uppercase tracking-[0.25em] text-charcoal/50 font-medium mt-1">
              TRAVELLERS INN &bull; ROLE-BASED PMS
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs font-mono text-center"
              >
                {error}
              </motion.div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 block font-semibold">
                Operator ID (Username)
              </label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal/40" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError('');
                  }}
                  placeholder="Enter username"
                  className="w-full pl-9 pr-4 py-2.5 bg-cream/30 border border-secondary/60 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition text-sm font-mono text-charcoal"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-charcoal/60 block font-semibold">
                Access Code (Password)
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal/40" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="Enter access code"
                  className="w-full pl-9 pr-4 py-2.5 bg-cream/30 border border-secondary/60 rounded-xl focus:border-primary focus:ring-1 focus:ring-primary outline-none transition text-sm font-mono text-charcoal"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="w-full bg-primary hover:bg-primary-light text-white font-sans text-sm font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition shadow-md shadow-primary/10 hover:shadow-primary/25 active:scale-[0.98]"
              >
                Initiate Session
                <ArrowRight size={16} />
              </button>
            </div>
          </form>


          {/* Quick fallback instruction */}
          <div className="mt-4 border-t border-secondary/40 pt-3 flex items-center justify-between">
            <span className="text-[10px] font-mono text-charcoal/40 uppercase">
              Admin: <strong className="text-primary font-bold">admin</strong> / <strong className="text-primary font-bold">admin</strong>
            </span>
            {onOpenLaunchAnimation && (
              <button
                type="button"
                onClick={onOpenLaunchAnimation}
                className="text-[10px] font-sans font-bold text-primary hover:text-primary-light flex items-center gap-1 cursor-pointer transition"
              >
                <Play size={10} className="text-amber-500 fill-amber-500" />
                Watch Intro
              </button>
            )}
          </div>
        </motion.div>


      </div>

      {/* Footer */}
      <div className="border-t border-secondary/25 pt-4 text-center text-[10px] font-mono text-charcoal/40 tracking-widest uppercase">
        &copy; {currentTime.getFullYear()} Sedona Court Travellers Inn &bull; Version 4.2.1-Prod
      </div>
    </div>
  );
};
