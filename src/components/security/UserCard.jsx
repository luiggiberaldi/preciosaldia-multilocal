import React from 'react';
import { Crown } from 'lucide-react';
import LoginAvatar from './LoginAvatar';
import { CardBody, CardContainer, CardItem } from '../ui/3d-card';

const toTitleCase = (str) => {
  if (!str) return '';
  return str.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

export default function UserCard({ user, onClick }) {
  const isAdmin = user.rol === 'ADMIN';

  return (
    <div onClick={onClick} className="cursor-pointer outline-none focus:outline-none active:scale-95 transition-transform duration-200">
      <CardContainer className="inter-var py-0">
        <CardBody className="relative group/card w-auto h-auto rounded-xl p-0 border-transparent bg-transparent">

          <CardItem translateZ="100" rotateX={10} rotateZ={-5} className="w-full flex justify-center">
            <div className="relative">
              <style>{`
                @keyframes rotBGimg {
                  from { transform: rotate(0deg); }
                  to { transform: rotate(360deg); }
                }
              `}</style>

              {/* Fake thickness layers (3D depth) */}
              <div className="absolute inset-0 bg-black/40 rounded-3xl translate-y-4 translate-x-4 blur-xl" />
              <div className={`absolute inset-0 rounded-3xl translate-y-2 translate-x-1 ${isAdmin ? 'bg-brand/20' : 'bg-emerald-500/20'}`} />

              {/* Admin Crown */}
              {isAdmin && (
                <div className="absolute -top-3 -left-3 z-50 animate-bounce duration-1000">
                  <div className="bg-gradient-to-br from-yellow-300 to-amber-500 p-1.5 rounded-full shadow-[0_0_15px_rgba(251,191,36,0.6)] border border-yellow-100/50">
                    <Crown size={20} className="text-yellow-900 fill-yellow-100" strokeWidth={2.5} />
                  </div>
                </div>
              )}

              {isAdmin ? (
                <div className="relative z-10 p-[4px] rounded-2xl overflow-hidden flex justify-center items-center shadow-[0_0_20px_rgba(0,183,255,0.4)]">
                  {/* RGB animated border */}
                  <div style={{
                    position: 'absolute',
                    width: '200%',
                    height: '200%',
                    backgroundImage: 'linear-gradient(180deg, rgb(0, 183, 255), rgb(255, 48, 255))',
                    animation: 'rotBGimg 3s linear infinite',
                  }} />
                  <div className="relative z-20 bg-slate-900 rounded-2xl">
                    <LoginAvatar user={user} className="relative z-10 transition-all duration-300 shadow-none ring-0" />
                  </div>
                </div>
              ) : (
                <div className="relative z-10 p-[4px] rounded-2xl overflow-hidden flex justify-center items-center bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/30 transition-all duration-300">
                  <div className="relative z-20 bg-slate-900 rounded-2xl">
                    <LoginAvatar user={user} className="relative z-10 transition-all duration-300 shadow-none ring-0" />
                  </div>
                </div>
              )}
            </div>
          </CardItem>

          {/* Text floating below */}
          <CardItem translateZ="60" className="text-center w-full mt-8 group-hover/card:text-primary transition-colors space-y-1">
            <h3 className="text-lg font-bold text-slate-800 drop-shadow-sm">
              {toTitleCase(user.nombre)}
            </h3>
            <span className={`block text-[9px] font-black uppercase tracking-[0.2em] ${isAdmin ? 'text-brand' : 'text-emerald-600'}`}>
              {user.rol === 'ADMIN' ? 'Administrador' : 'Cajero'}
            </span>
          </CardItem>

        </CardBody>
      </CardContainer>
    </div>
  );
}
