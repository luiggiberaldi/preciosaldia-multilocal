import React from 'react';

const AVATAR_COLORS = {
  ADMIN: { bg: 'from-brand to-brand-dark', text: 'text-white' },
  CAJERO: { bg: 'from-emerald-500 to-teal-500', text: 'text-white' },
};

export default function LoginAvatar({ user, size = 'lg' }) {
  const initial = (user?.nombre || 'U').charAt(0).toUpperCase();
  const colors = AVATAR_COLORS[user?.rol] || AVATAR_COLORS.CAJERO;
  const sizeClasses = size === 'lg' ? 'w-28 h-28 text-4xl' : 'w-10 h-10 text-base';

  return (
    <div className={`${sizeClasses} rounded-2xl bg-gradient-to-br ${colors.bg} flex items-center justify-center font-black ${colors.text} select-none shadow-lg`}>
      {initial}
    </div>
  );
}
