import React, { useState, useRef, useEffect } from 'react';
import { X, Delete, Loader2 } from 'lucide-react';
import LoginAvatar from './LoginAvatar';
import { PIN_POLICY } from '../../utils/securityConstants';

export default function LoginPinModal({ isOpen, onClose, user, onSubmit }) {
  // SEC-017: Todos los roles requieren PIN de MIN_LENGTH (6) dígitos.
  // Antes el cajero usaba 4 dígitos, lo que reducía el espacio de claves a 10^4
  // (trivialmente brute-forceable con el rate-limiting por defecto).
  const pinLength = PIN_POLICY.MIN_LENGTH;
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [lockoutMsg, setLockoutMsg] = useState('');
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(false);
      setLockoutMsg('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (pin.length === pinLength && !processing) {
      handleSubmit();
    }
  }, [pin]);

  const handleSubmit = async () => {
    if (pin.length !== pinLength || processing) return;
    setProcessing(true);
    setLockoutMsg('');

    const result = await onSubmit(pin, user?.id);

    if (result?.error && result.error.includes('Bloqueado')) {
      setLockoutMsg(result.error);
      setPin('');
      setProcessing(false);
      return;
    }

    if (!result?.success) {
      setError(true);
      setPin('');
      setProcessing(false);
      setTimeout(() => setError(false), 600);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handlePadPress = (digit) => {
    if (pin.length >= pinLength || processing || lockoutMsg) return;
    setLockoutMsg('');
    setPin(prev => prev + digit);
  };

  const handleDelete = () => {
    if (processing) return;
    setPin(prev => prev.slice(0, -1));
  };

  if (!isOpen || !user) return null;

  const userName = (user.nombre || 'Usuario').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-xl animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="relative bg-slate-900/95 backdrop-blur-2xl rounded-3xl p-8 w-full max-w-sm mx-4 shadow-2xl border border-white/10 animate-in zoom-in-95 duration-300"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-slate-500 hover:text-white transition-colors rounded-full hover:bg-white/10">
          <X size={20} />
        </button>

        <div className="flex flex-col items-center mb-8">
          <div className="mb-4">
            <LoginAvatar user={user} />
          </div>
          <h2 className="text-xl font-bold text-white">{userName}</h2>
          <p className="text-xs text-slate-400 mt-1">Ingresa tu PIN de {pinLength} dígitos</p>
        </div>

        {/* PIN Dots */}
        <div className={`flex justify-center gap-3 mb-4 ${error ? 'animate-shake' : ''}`}>
          {Array.from({ length: pinLength }).map((_, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                error
                  ? 'bg-red-500 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                  : i < pin.length
                    ? 'bg-brand border-brand shadow-[0_0_10px_rgba(var(--brand-rgb,59,130,246),0.4)] scale-110'
                    : 'bg-transparent border-slate-600'
              }`}
            />
          ))}
        </div>

        {lockoutMsg && (
          <div className="mb-4 px-4 py-2 bg-red-500/20 border border-red-500/40 rounded-xl text-center">
            <p className="text-red-400 text-sm font-semibold">{lockoutMsg}</p>
          </div>
        )}

        <input
          ref={inputRef}
          type="tel"
          maxLength={pinLength}
          value={pin}
          disabled={!!lockoutMsg}
          onChange={e => {
            if (lockoutMsg) return;
            const val = e.target.value.replace(/\D/g, '').slice(0, pinLength);
            setPin(val);
          }}
          className="absolute opacity-0 w-0 h-0"
          autoComplete="off"
          inputMode="numeric"
        />

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button
              key={n}
              onClick={() => handlePadPress(String(n))}
              className="h-14 rounded-xl bg-slate-800/80 text-white text-xl font-bold hover:bg-slate-700 active:scale-90 active:bg-brand/30 transition-all duration-150 border border-white/5 shadow-lg"
            >
              {n}
            </button>
          ))}
          <div />
          <button
            onClick={() => handlePadPress('0')}
            className="h-14 rounded-xl bg-slate-800/80 text-white text-xl font-bold hover:bg-slate-700 active:scale-90 active:bg-brand/30 transition-all duration-150 border border-white/5 shadow-lg"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="h-14 rounded-xl bg-slate-800/50 text-slate-400 flex items-center justify-center hover:bg-red-500/20 hover:text-red-400 active:scale-90 transition-all duration-150 border border-white/5"
          >
            <Delete size={22} />
          </button>
        </div>

        {processing && (
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm rounded-3xl flex items-center justify-center">
            <Loader2 className="animate-spin text-brand" size={32} />
          </div>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-10px); }
          40% { transform: translateX(10px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}
