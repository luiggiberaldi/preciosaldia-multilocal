import React from 'react';

export default function Skeleton({ className = '', style = {} }) {
    return (
        <div 
            className={`bg-slate-200 dark:bg-slate-800 animate-pulse rounded-xl ${className}`}
            style={style}
        />
    );
}
