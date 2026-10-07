import {
    ShoppingBasket, Droplets, Sparkles, Beef, Wheat,
    Milk, Drumstick, Leaf, Croissant, ShoppingBag,
    Package, LayoutGrid
} from 'lucide-react';

// Categorías predefinidas para el Inventario
export const BODEGA_CATEGORIES = [
    { id: 'todos', label: 'Todos', icon: '◉', color: 'slate' },
    { id: 'general', label: 'General', icon: '◆', color: 'blue' },
];

// Lucide icon map for factory categories
export const CATEGORY_ICONS = {
    todos: LayoutGrid,
    bebidas: Droplets,
    limpieza: Sparkles,
    charcuteria: Beef,
    snacks: ShoppingBasket,
    granos: Wheat,
    lacteos: Milk,
    carnes: Drumstick,
    verduras: Leaf,
    panaderia: Croissant,
    viveres: ShoppingBag,
    otros: Package,
};

export const UNITS = [
    { id: 'unidad', label: 'Unidad', short: 'uni' },
    { id: 'paquete', label: 'Caja/Bulto', short: 'cja' },
    { id: 'kg', label: 'Kilogramo', short: 'kg' },
    { id: 'litro', label: 'Litro', short: 'lt' },
];

// Colores de Tailwind para las pastillas de categoría
export const CATEGORY_COLORS = {
    blue: 'bg-brand-light text-brand-dark dark:bg-surface-800 dark:text-brand',
    cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700/30 dark:text-slate-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400',
};
