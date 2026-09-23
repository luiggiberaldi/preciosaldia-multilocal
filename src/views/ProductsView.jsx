import React, { useState, useRef, useEffect, useMemo } from 'react';
// v1.2.0: useReveal hook para animaciones reveal-on-scroll (design system "Precios al Día")
import { useReveal } from '../hooks/useReveal';
import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';
import { Package, Plus, Trash2, X, Store, Tag, Pencil, Banknote, Search, ChevronLeft, ChevronRight, AlertTriangle, Box, LayoutGrid, List, Minus, ArrowUpDown, Clock, Percent, Printer, CheckSquare } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ProductShareModal } from '../components/ProductShareModal';
import { useAuthStore } from '../hooks/store/useAuthStore';

import ShareInventoryModal from '../components/ShareInventoryModal';
import { formatBs, formatUsd, smartCashRounding, getCop, getUsd } from '../utils/calculatorUtils';
import { generarEtiquetas } from '../utils/ticketGenerator';
import { useWallet } from '../hooks/useWallet';
import { BODEGA_CATEGORIES, UNITS, CATEGORY_COLORS } from '../config/categories';
import ProductCard from '../components/Products/ProductCard';
import ProductFormModal from '../components/Products/ProductFormModal';
import ProductsToolbar from '../components/Products/ProductsToolbar';
import ConfirmModal from '../components/ConfirmModal';
import CategoryManagerModal from '../components/Products/CategoryManagerModal';
import BulkPriceAdjustModal from '../components/Products/BulkPriceAdjustModal';
import StockBatchModal from '../components/Products/StockBatchModal';
import { useProductContext } from '../context/ProductContext';
import SmartImage from '../components/SmartImage';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import SwipeableItem from '../components/SwipeableItem';
import { useInventoryVelocity } from '../hooks/useInventoryVelocity';
import { useProductFiltering } from '../hooks/useProductFiltering';
import { useProductForm } from '../hooks/useProductForm';
import { useProductSorting } from '../hooks/useProductSorting';
import { buildProductPayload } from '../utils/productProcessor';
import { isGranelProduct, formatStockDisplay } from '../utils/granel'; // GRANEL-001
import { uploadProductImage, migrateProductImagesToStorage } from '../utils/imageUpload';
// useAuthStore removed - single-user app
import { useAudit } from '../hooks/useAudit';

export const ProductsView = ({ rates, triggerHaptic }) => {
    // v1.2.0: reveal-on-scroll para banners y secciones de cabecera (NO en grid paginado para evitar re-trigger).
    const revealRef = useReveal();

    // ─── STATE DEL HOOK ─────────────────────────────────────
    const {
        products, setProducts,
        categories, setCategories,
        isLoadingProducts,
        streetRate, setStreetRate,
        useAutoRate, setUseAutoRate,
        customRate, setCustomRate,
        effectiveRate,
        copEnabled,
        copPrimary,
        tasaCop,
        adjustStock: baseAdjustStock,
        setDirectStock
    } = useProductContext();
    const isCajero = useAuthStore(s => s.requireLogin && s.usuarioActivo?.rol === 'CAJERO');
    const { log: auditLog } = useAudit();

    // Envolver adjustStock para incluir registro de movimiento + haptic
    const adjustStock = async (productId, delta) => {
        baseAdjustStock(productId, delta);
        triggerHaptic && triggerHaptic();

        // Registro silencioso del ajuste de inventario
        try {
            const product = products.find(p => p.id === productId);
            const record = {
                id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                timestamp: new Date().toISOString(),
                tipo: delta > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
                items: [{ id: productId, name: product?.name || 'Producto', qty: Math.abs(delta) }],
                totalUsd: 0,
                totalBs: 0,
                status: 'COMPLETADA',
            };
            const sales = await storageService.getItem('bodega_sales_v1', []);
            sales.push(record);
            await storageService.setItem('bodega_sales_v1', sales);
        } catch (e) { /* silencioso */ }
    }

    // Modal UI States
    const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [highPriceConfirm, setHighPriceConfirm] = useState(null); // { price, pendingData }

    const [isShareOpen, setIsShareOpen] = useState(false);
    const [isBulkPriceOpen, setIsBulkPriceOpen] = useState(false);
    const [isStockBatchOpen, setIsStockBatchOpen] = useState(false);
    const [deleteCategoryConfirmId, setDeleteCategoryConfirmId] = useState(null);

    // Share State
    const [shareProduct, setShareProduct] = useState(null);
    const { accounts } = useWallet();

    // Paginación, Búsqueda y Filtro por Categoría
    const [searchTerm, setSearchTerm] = useState('');
    const [activeCategory, setActiveCategory] = useState('todos');
    const [currentPage, setCurrentPage] = useState(1);
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('bodega_inventory_view') || 'grid');
    const { sortField, sortDir, handleSort: baseSortHandler } = useProductSorting();
    const handleSort = (field) => baseSortHandler(field, setCurrentPage);
    const [itemsPerPage, setItemsPerPage] = useState(() => {
        const mode = localStorage.getItem('bodega_inventory_view') || 'grid';
        if (mode === 'list') return 25;
        const w = window.innerWidth;
        return w >= 1536 ? 30 : w >= 1280 ? 24 : w >= 1024 ? 20 : w >= 768 ? 12 : w >= 640 ? 9 : 8;
    });
    useEffect(() => {
        const handleResize = () => {
            if (viewMode === 'grid') {
                const w = window.innerWidth;
                setItemsPerPage(w >= 1536 ? 30 : w >= 1280 ? 24 : w >= 1024 ? 20 : w >= 768 ? 12 : w >= 640 ? 9 : 8);
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [viewMode]);

    // ─── FASE 3 (Egress): migración única de imágenes base64 → Storage ───────
    // Las imágenes viejas viven como base64 dentro de bodega_products_v1 (el doc
    // que se sincroniza por Realtime). Las subimos a Storage una sola vez y las
    // reemplazamos por URLs, encogiendo el doc y cortando su re-emisión en cada
    // cambio de stock/precio. Guardado por flag; solo online; en segundo plano.
    // Seguro: si un upload falla, ese producto conserva su base64 y se reintenta
    // en la próxima sesión (el flag solo se fija si migró todo sin fallos).
    useEffect(() => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        if (localStorage.getItem('pda_images_migrated_v1') === 'true') return;

        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const current = await storageService.getItem('bodega_products_v1', []);
                const hasBase64 = Array.isArray(current)
                    && current.some(p => typeof p?.image === 'string' && p.image.startsWith('data:'));
                if (!hasBase64) {
                    localStorage.setItem('pda_images_migrated_v1', 'true');
                    return;
                }

                const res = await migrateProductImagesToStorage(current, async (out) => {
                    await storageService.setItem('bodega_products_v1', out);
                    if (!cancelled) setProducts(out);
                });

                if (res.failed === 0) {
                    localStorage.setItem('pda_images_migrated_v1', 'true');
                }
                if (res.migrated > 0) {
                    showToast(`${res.migrated} imágenes movidas a la nube`, 'success');
                }
            } catch {
                // Silencioso: se reintenta en la próxima sesión.
            }
        }, 4000);

        return () => { cancelled = true; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggleViewMode = () => {
        const next = viewMode === 'grid' ? 'list' : 'grid';
        setViewMode(next);
        localStorage.setItem('bodega_inventory_view', next);
        setCurrentPage(1);
        setItemsPerPage(next === 'list' ? 25 : (() => { const w = window.innerWidth; return w >= 1536 ? 30 : w >= 1280 ? 24 : w >= 1024 ? 20 : w >= 768 ? 12 : w >= 640 ? 9 : 8; })());
        triggerHaptic && triggerHaptic();
    };

    // Selección múltiple para etiquetas
    const [selectedIds, setSelectedIds] = useState(new Set());

    // ─── COP PRICE CORRECTION ─────────────────────────────────
    const [copCorrectionDismissed, setCopCorrectionDismissed] = useState(false);
    const suspectCopProducts = useMemo(() => {
        if (!copEnabled || !tasaCop || tasaCop <= 0) return [];
        // Products with priceUsdt >= 500 are likely COP values stored as USD
        return products.filter(p => p.priceUsdt >= 500);
    }, [products, copEnabled, tasaCop]);

    const handleFixCopPrices = () => {
        if (suspectCopProducts.length === 0 || !tasaCop || tasaCop <= 0) return;
        const idsToFix = new Set(suspectCopProducts.map(p => p.id));
        setProducts(prev =>
            prev.map(p => {
                if (!idsToFix.has(p.id)) return p;
                const correctedUsd = parseFloat((p.priceUsdt / tasaCop).toFixed(4));
                const updated = { ...p, priceUsdt: correctedUsd };
                if (p.unitPriceUsd && p.unitPriceUsd > 0) {
                    updated.unitPriceUsd = parseFloat((p.unitPriceUsd / tasaCop).toFixed(4));
                }
                if (p.costUsd && p.costUsd >= 500) {
                    updated.costUsd = parseFloat((p.costUsd / tasaCop).toFixed(4));
                    updated.costBs = parseFloat((updated.costUsd * effectiveRate).toFixed(2));
                }
                return updated;
            })
        );
        showToast(`${suspectCopProducts.length} productos corregidos: pesos → USD`, 'success');
        auditLog('INVENTARIO', 'CORRECCION_COP_A_USD', `Corregidos ${suspectCopProducts.length} productos de COP a USD con tasa ${tasaCop}`);
        setCopCorrectionDismissed(true);
    };
    
    const handleToggleSelect = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedIds(new Set(paginatedProducts.map(p => p.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handlePrintSelected = () => {
        const toPrint = products.filter(p => selectedIds.has(p.id));
        generarEtiquetas(toPrint, effectiveRate, copEnabled, tasaCop);
        setSelectedIds(new Set());
        showToast(`Generando ${toPrint.length} etiquetas`, 'success');
    };

    const handlePrintSingle = (p) => {
        generarEtiquetas([p], effectiveRate, copEnabled, tasaCop);
    };

    // Form State (Product Edit/Create)
    const {
        editingId, setEditingId,
        name, setName,
        barcode, setBarcode,
        priceUsd, setPriceUsd,
        priceBs, setPriceBs,
        pricingMode, setPricingMode,
        priceBsUsdRef, setPriceBsUsdRef,
        costUsd, setCostUsd,
        costBs, setCostBs,
        stock, setStock,
        unit, setUnit,
        unitsPerPackage, setUnitsPerPackage,
        sellByUnit, setSellByUnit,
        unitPriceUsd, setUnitPriceUsd,
        category, setCategory,
        lowStockAlert, setLowStockAlert,
        image, setImage,
        packagingType, setPackagingType,
        stockInLotes, setStockInLotes,
        granelUnit, setGranelUnit,
        isFormShaking, setIsFormShaking,
        resetForm,
        populateForm,
    } = useProductForm();
    const fileInputRef = useRef(null);
    const categoryScrollRef = useRef(null);

    // Form State (Category create)
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryIcon, setNewCategoryIcon] = useState('📦');

    // Delete State
    const [deleteId, setDeleteId] = useState(null);
    const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
    const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
    const [productMovements, setProductMovements] = useState([]);

    // ─── SALES VELOCITY (Días de Inventario) ────────────────
    const { salesVelocityMap } = useInventoryVelocity(products.length);

    // ─── FILTERING & PAGINATION ─────────────────────────────

    const { filteredProducts } = useProductFiltering(products, searchTerm, activeCategory, sortField, sortDir, effectiveRate);

    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    const paginatedProducts = filteredProducts.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Auto-reset page when filter changes
    // (Linter safe approach instead of an effect calling setState synchronously)
    const handleSetSearchTerm = (term) => {
        setSearchTerm(term);
        setCurrentPage(1);
    }

    const handleSetActiveCategory = (cat) => {
        setActiveCategory(cat);
        setCurrentPage(1);
    }

    // Low stock count
    const lowStockCount = products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5) && (p.stock ?? 0) >= 0).length;

    // ─── IMAGE HANDLER ──────────────────────────────────────

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 400;
                let width = img.width, height = img.height;
                if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } }
                else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                setImage(canvas.toDataURL('image/webp', 0.7));
            };
        };
    };

    // ─── HANDLERS BIMONEDA ──────────────────────────────────
    const [priceCop, setPriceCop] = useState('');
    const [unitPriceCop, setUnitPriceCop] = useState('');
    const [costCop, setCostCop] = useState('');

    const handlePriceUsdChange = (val) => {
        setPriceUsd(val);
        if (!val || parseFloat(val) <= 0) { setPriceBs(''); setPriceCop(''); return; }
        setPriceBs((parseFloat(val) * effectiveRate).toFixed(2));
        if (copEnabled && tasaCop > 0) setPriceCop(Math.round(parseFloat(val) * tasaCop).toString());
    };

    const handlePriceBsChange = (val) => {
        setPriceBs(val);
        if (!val || parseFloat(val) <= 0) { setPriceUsd(''); setPriceCop(''); return; }
        const usd = parseFloat(val) / effectiveRate;
        setPriceUsd(usd.toFixed(2));
        if (copEnabled && tasaCop > 0) setPriceCop(Math.round(usd * tasaCop).toString());
    };

    const handlePriceCopChange = (val) => {
        setPriceCop(val);
        if (!val || parseFloat(val) <= 0) { setPriceUsd(''); setPriceBs(''); return; }
        if (tasaCop <= 0) return;
        const usd = parseFloat(val) / tasaCop;
        // Usar 4 decimales para que al reconvertir a COP dé el valor original
        setPriceUsd(usd.toFixed(4));
        setPriceBs((usd * effectiveRate).toFixed(2));
    };

    const handleCostUsdChange = (val) => {
        setCostUsd(val);
        if (!val || parseFloat(val) <= 0) { setCostBs(''); setCostCop(''); return; }
        setCostBs((parseFloat(val) * effectiveRate).toFixed(2));
        if (copEnabled && tasaCop > 0) setCostCop(Math.round(parseFloat(val) * tasaCop).toString());
    };

    const handleCostBsChange = (val) => {
        setCostBs(val);
        if (!val || parseFloat(val) <= 0) { setCostUsd(''); setCostCop(''); return; }
        const usd = parseFloat(val) / effectiveRate;
        setCostUsd(usd.toFixed(2));
        if (copEnabled && tasaCop > 0) setCostCop(Math.round(usd * tasaCop).toString());
    };

    const handleCostCopChange = (val) => {
        setCostCop(val);
        if (!val || parseFloat(val) <= 0) { setCostUsd(''); setCostBs(''); return; }
        if (tasaCop <= 0) return;
        const usd = parseFloat(val) / tasaCop;
        setCostUsd(usd.toFixed(2));
        setCostBs((usd * effectiveRate).toFixed(2));
    };

    // ─── CRUD ───────────────────────────────────────────────

    const handleSave = () => {
        triggerHaptic && triggerHaptic();
        if (!name || (!priceUsd && !priceBs)) {
            setIsFormShaking(true);
            setTimeout(() => setIsFormShaking(false), 500);
            return showToast('Nombre y precio requeridos', 'warning');
        }

        const productData = buildProductPayload({
            name, barcode, priceUsd, priceBs, pricingMode, priceBsUsdRef, priceCop, costUsd, costBs, stock, stockInLotes,
            packagingType, unitsPerPackage, granelUnit, sellByUnit, unitPriceUsd, unitPriceCop,
            category, lowStockAlert
        }, effectiveRate);

        // Advertencia si el precio parece inusualmente alto
        const parsedPrice = parseFloat(priceUsd) || 0;
        if (parsedPrice > 500 && !highPriceConfirm) {
            setHighPriceConfirm({ price: parsedPrice, pendingData: productData });
            return;
        }

        _commitSave(productData);
    };

    const _commitSave = async (productData) => {
        setHighPriceConfirm(null);

        const productId = editingId || crypto.randomUUID();

        // FASE 3 (Egress): si la imagen es base64, subirla a Storage y guardar la
        // URL en vez del data URI, para que no viaje dentro del doc de sync.
        // Si falla (offline/límite), uploadProductImage devuelve null y se conserva
        // el base64 — nunca se pierde la imagen. Las imágenes ya en URL o "" pasan
        // tal cual (no se re-suben).
        let finalImage = image;
        if (typeof image === 'string' && image.startsWith('data:')) {
            const url = await uploadProductImage(image, { id: productId });
            if (url) finalImage = url;
        }

        let updatedProducts;
        if (editingId) {
            updatedProducts = products.map(p =>
                // FIX-IMAGE-001: `image || p.image` ignoraba el borrado explícito porque
                // "" (string vacío) es falsy en JS y caía al fallback con la foto vieja.
                // Ahora solo usamos la imagen previa si image es estrictamente `undefined`
                // (es decir, el campo nunca fue tocado en el formulario).
                p.id === editingId ? { ...p, ...productData, image: finalImage !== undefined ? finalImage : p.image } : p
            );
            auditLog('INVENTARIO', 'PRODUCTO_EDITADO', `Producto "${name}" editado`);
        } else {
            updatedProducts = [{
                id: productId,
                ...productData,
                image: finalImage,
                createdAt: new Date().toISOString()
            }, ...products];
            auditLog('INVENTARIO', 'PRODUCTO_CREADO', `Producto "${name}" creado - $${priceUsd || '0'}`);
        }

        // FIX-SAVE-001: Persistir INMEDIATAMENTE antes de cerrar el modal.
        // El debounce del useEffect en ProductContext puede ser cancelado por el
        // clearTimeout cuando handleClose() dispara un re-render antes de que el
        // timer de 1s se ejecute, haciendo que el guardado se pierda silenciosamente.
        storageService.setItem('bodega_products_v1', updatedProducts);

        setProducts(updatedProducts);
        handleClose();
    };


    const handleEdit = async (product) => {
        triggerHaptic && triggerHaptic();
        populateForm(product, effectiveRate);
        // Set COP price for editing: use stored priceCop if available, otherwise derive
        if (copEnabled && tasaCop > 0) {
            if (product.priceCop != null && product.priceCop > 0) {
                setPriceCop(product.priceCop.toString());
                // Recalculate USD and Bs from COP at current rate
                const usd = product.priceCop / tasaCop;
                setPriceUsd(usd.toFixed(4));
                setPriceBs((usd * effectiveRate).toFixed(2));
            } else if (product.priceUsdt > 0) {
                setPriceCop(Math.round(product.priceUsdt * tasaCop).toString());
            } else {
                setPriceCop('');
            }
        } else {
            setPriceCop('');
        }
        // Set COP unit price for editing
        if (copEnabled && tasaCop > 0) {
            if (product.unitPriceCop != null && product.unitPriceCop > 0) {
                setUnitPriceCop(product.unitPriceCop.toString());
            } else if (product.unitPriceUsd > 0) {
                setUnitPriceCop(Math.round(product.unitPriceUsd * tasaCop).toString());
            } else {
                setUnitPriceCop('');
            }
        } else {
            setUnitPriceCop('');
        }
        // Set COP cost for editing
        if (copEnabled && tasaCop > 0 && product.costUsd > 0) {
            setCostCop(Math.round(product.costUsd * tasaCop).toString());
        } else {
            setCostCop('');
        }

        setIsModalOpen(true);

        // Load product movements (Kardex Lite)
        try {
            const allSales = await storageService.getItem('bodega_sales_v1', []);
            const movements = allSales
                .filter(s => (s.items || []).some(i => i.id === product.id || i.name === product.name))
                .map(s => {
                    const item = (s.items || []).find(i => i.id === product.id || i.name === product.name);
                    return {
                        id: s.id,
                        timestamp: s.timestamp,
                        tipo: s.tipo || 'VENTA',
                        qty: item?.qty,
                        clienteName: s.clienteName || null,
                    };
                })
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 20);
            setProductMovements(movements);
        } catch (e) {
            setProductMovements([]);
        }
    };

    const handleDelete = (id) => { triggerHaptic && triggerHaptic(); setDeleteId(id); };
    const confirmDelete = () => {
        if (deleteId) {
            const p = products.find(x => x.id === deleteId);
            auditLog('INVENTARIO', 'PRODUCTO_ELIMINADO', `Producto "${p?.name || '?'}" eliminado`);
            const updatedProducts = products.filter(prod => prod.id !== deleteId);
            storageService.setItem('bodega_products_v1', updatedProducts);
            setProducts(updatedProducts);
            setDeleteId(null);
            triggerHaptic && triggerHaptic();
        }
    };

    const handleClose = () => {
        resetForm();
        setPriceCop('');
        setUnitPriceCop('');
        setCostCop('');
        setIsModalOpen(false);
        setProductMovements([]);
    };

    // Gestionar Categorias
    const handleAddCategory = () => {
        if (!newCategoryName.trim()) return;
        const newCat = {
            id: newCategoryName.trim().toLowerCase().replace(/\s+/g, '_'),
            label: newCategoryName.trim(),
            icon: newCategoryIcon,
            color: 'slate'
        };

        // Evitar duplicados
        if (categories.find(c => c.id === newCat.id)) {
            showToast('Esta categoría ya existe', 'warning');
            return;
        }

        setCategories([...categories, newCat]);
        setNewCategoryName('');
        setNewCategoryIcon('📦');
        triggerHaptic && triggerHaptic();
    };

    const handleDeleteCategory = (categoryId) => {
        if (categoryId === 'todos' || categoryId === 'otros') {
            showToast('No puedes eliminar una categoría del sistema', 'warning');
            return;
        }

        const hasProducts = products.some(p => p.category === categoryId);
        if (hasProducts) {
            showToast('No puedes borrar esta categoría porque tiene productos. Cámbialos primero.', 'warning');
            return;
        }

        setDeleteCategoryConfirmId(categoryId);
    };

    const confirmDeleteCategory = () => {
        const categoryId = deleteCategoryConfirmId;
        if (!categoryId) return;
        const newCats = categories.filter(c => c.id !== categoryId);
        setCategories(newCats);
        if (activeCategory === categoryId) handleSetActiveCategory('todos');
        triggerHaptic && triggerHaptic();
        setDeleteCategoryConfirmId(null);
    };

    // ─── RENDER ─────────────────────────────────────────────

    return (
        <div ref={revealRef} className="flex flex-col h-full bg-surface-50 dark:bg-surface-950 p-3 sm:p-6 overflow-y-auto">

            {/* Header — Toolbar */}
            <ProductsToolbar
                products={products}
                categories={categories}
                activeCategory={activeCategory}
                searchTerm={searchTerm}
                viewMode={viewMode}
                selectedIds={selectedIds}
                lowStockCount={lowStockCount}
                isCajero={isCajero}
                categoryScrollRef={categoryScrollRef}
                handleSetSearchTerm={handleSetSearchTerm}
                handleSetActiveCategory={handleSetActiveCategory}
                toggleViewMode={toggleViewMode}
                setSelectedIds={setSelectedIds}
                setIsModalOpen={setIsModalOpen}
                setIsBulkPriceOpen={setIsBulkPriceOpen}
                setIsDeleteAllModalOpen={setIsDeleteAllModalOpen}
                setIsCategoryManagerOpen={setIsCategoryManagerOpen}
                setIsStockBatchOpen={setIsStockBatchOpen}
                triggerHaptic={triggerHaptic}
                onSelectAllToast={() => showToast('Todo el inventario seleccionado', 'success')}
            />

            {/* ─── COP PRICE CORRECTION BANNER ─── */}
            {copEnabled && suspectCopProducts.length > 0 && !copCorrectionDismissed && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 p-3 rounded-xl mb-3 shrink-0 animate-in slide-in-from-top-2">
                    <div className="flex items-start gap-2">
                        <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-red-700 dark:text-red-400">
                                {suspectCopProducts.length} producto{suspectCopProducts.length > 1 ? 's' : ''} con precios que parecen ser pesos colombianos
                            </p>
                            <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5">
                                Ej: {suspectCopProducts.slice(0, 2).map(p => `${p.name} ($${p.priceUsdt.toLocaleString()})`).join(', ')}
                                {suspectCopProducts.length > 2 ? ` y ${suspectCopProducts.length - 2} más` : ''}
                            </p>
                            <div className="flex gap-2 mt-2">
                                {/* v1.2.0: touch targets ≥ 48px (a11y WCAG AA) */}
                                <button
                                    onClick={handleFixCopPrices}
                                    className="px-4 py-2.5 min-h-[48px] flex items-center bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
                                >
                                    Corregir: convertir de COP a USD (tasa: {tasaCop?.toLocaleString()})
                                </button>
                                <button
                                    onClick={() => setCopCorrectionDismissed(true)}
                                    className="px-3 py-2.5 min-h-[48px] flex items-center text-xs font-bold text-red-500 hover:text-red-700 dark:text-red-400"
                                >
                                    Ignorar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- ACTION BAR SELECCION --- */}
            {selectedIds.size > 0 && (
                <div className="flex items-center justify-between gap-2 p-2 px-3 bg-brand/10 border border-brand/20 rounded-xl mb-3 shrink-0 animate-in slide-in-from-top-2">
                    <span className="text-sm font-bold text-brand flex items-center gap-1">
                        <CheckSquare size={16} aria-hidden="true" /> {selectedIds.size} seleccionados
                    </span>
                    <div className="flex gap-2">
                        {/* v1.2.0: touch targets ≥ 48px (a11y WCAG AA) */}
                        <button onClick={() => setSelectedIds(new Set())} className="px-3 py-2.5 min-h-[48px] flex items-center text-xs font-bold text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300">
                            Cancelar
                        </button>
                        <button onClick={handlePrintSelected} className="px-4 py-2.5 min-h-[48px] flex items-center bg-brand text-white text-xs font-bold rounded-lg shadow-sm hover:bg-brand-dark transition-all gap-1">
                            <Printer size={14} aria-hidden="true" /> <span className="hidden sm:inline">Imprimir Etiquetas</span><span className="sm:hidden">Imprimir</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Product Grid */}
            {isLoadingProducts ? (
                <div className="flex-1 overflow-y-auto pb-4 scrollbar-hide">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                        {[1,2,3,4,5,6,7,8,9,10].map(i => (
                            // v1.2.0: skeleton cards usan surface tokens (warm cream) en vez de white/slate.
                            <div key={i} className="bg-surface dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 p-3 h-56 flex flex-col justify-between">
                                <div>
                                    <Skeleton className="w-12 h-12 rounded-xl mb-3" />
                                    <Skeleton className="w-3/4 h-4 rounded mb-2" />
                                    <Skeleton className="w-1/2 h-3 rounded" />
                                </div>
                                <div>
                                    <Skeleton className="w-full h-8 rounded-lg mb-2" />
                                    <div className="flex justify-between">
                                        <Skeleton className="w-1/3 h-6 rounded-lg" />
                                        <Skeleton className="w-1/3 h-6 rounded-lg" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : products.length === 0 ? (
                <div className="flex-1 flex flex-col justify-center max-w-lg mx-auto w-full">
                    <EmptyState
                        icon={Package}
                        title="Inventario Vacío"
                        description="Aún no tienes productos registrados. Empieza a llenar tus anaqueles para poder vender."
                        actionLabel="NUEVO PRODUCTO"
                        onAction={() => { triggerHaptic && triggerHaptic(); setIsModalOpen(true); }}
                    />
                </div>
            ) : filteredProducts.length === 0 ? (
                <div className="flex-1 flex flex-col justify-center max-w-lg mx-auto w-full">
                    <EmptyState
                        icon={Search}
                        title="Sin resultados"
                        description={`No encontramos productos para "${searchTerm || activeCategory}".`}
                        secondaryActionLabel="Limpiar Filtros"
                        onSecondaryAction={() => { handleSetSearchTerm(''); handleSetActiveCategory('todos'); triggerHaptic && triggerHaptic(); }}
                    />
                </div>
            ) : (
                <>
                    {/* Bajo stock banner */}
                    {activeCategory === 'bajo-stock' && (
                        // v1.2.0: reveal-on-scroll + border-surface-300 (warm border).
                        <div className="reveal flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 px-3 py-2 rounded-xl mb-3 shrink-0">
                            <span className="text-xs font-bold text-amber-600 dark:text-amber-400">Mostrando productos con stock bajo</span>
                            {/* v1.2.0: touch target ≥ 48px (a11y WCAG AA) */}
                            <button onClick={() => handleSetActiveCategory('todos')} className="px-3 py-2 min-h-[40px] flex items-center text-xs font-bold text-amber-500 hover:text-amber-700 transition-colors gap-1">
                                × Ver todos
                            </button>
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto pb-4 scrollbar-hide">
                        {viewMode === 'grid' ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                            {paginatedProducts.map(p => (
                                // v1.2.0: hover lift wrapper para ProductCard (design system hover state).
                                <div key={p.id} className="transition-transform duration-200 hover:-translate-y-1">
                                <SwipeableItem
                                    onEdit={isCajero ? undefined : () => handleEdit(p)}
                                    onDelete={isCajero ? undefined : () => handleDelete(p.id)}
                                    triggerHaptic={triggerHaptic}
                                >
                                    <ProductCard
                                        product={p}
                                        effectiveRate={effectiveRate}
                                        streetRate={streetRate}
                                        categories={categories}
                                        copEnabled={copEnabled}
                                        copPrimary={copPrimary}
                                        tasaCop={tasaCop}
                                        onAdjustStock={adjustStock}
                                        onSetDirectStock={setDirectStock}
                                        onShare={setShareProduct}
                                        onEdit={isCajero ? undefined : handleEdit}
                                        onDelete={isCajero ? undefined : handleDelete}
                                        readOnly={isCajero}
                                        daysRemaining={
                                            salesVelocityMap[p.id] > 0 && (p.stock ?? 0) > 0
                                                ? Math.round((p.stock ?? 0) / salesVelocityMap[p.id])
                                                : null
                                        }
                                        isSelected={selectedIds.has(p.id)}
                                        onToggleSelect={() => handleToggleSelect(p.id)}
                                        onPrint={() => handlePrintSingle(p)}
                                    />
                                </SwipeableItem>
                                </div>
                            ))}
                        </div>
                        ) : (
                        /* ── LIST VIEW ── */
                        // v1.2.0: surface tokens + border-surface-300 (warm border) para la lista.
                        <div className="bg-surface dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-tone-sm overflow-hidden">
                            {/* Table Header — desktop */}
                            <div className="hidden sm:grid sm:grid-cols-[40px_1fr_100px_100px_70px_80px_110px] gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                <div className="flex items-center justify-center">
                                    <input type="checkbox" onChange={handleSelectAll} checked={selectedIds.size > 0 && selectedIds.size === paginatedProducts.length} className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer" />
                                </div>
                                <button onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors text-left">
                                    Producto {sortField === 'name' && <ArrowUpDown size={10} />}
                                </button>
                                <button onClick={() => handleSort('price')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                    Precio {sortField === 'price' && <ArrowUpDown size={10} />}
                                </button>
                                <span>{!isCajero && 'Costo'}</span>
                                {!isCajero && <button onClick={() => handleSort('margin')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                    Margen {sortField === 'margin' && <ArrowUpDown size={10} />}
                                </button>}
                                <button onClick={() => handleSort('stock')} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                    Stock {sortField === 'stock' && <ArrowUpDown size={10} />}
                                </button>
                                <span className="text-right">Acciones</span>
                            </div>
                            {/* Rows */}
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {paginatedProducts.map(p => {
                                    const valBs = p.priceUsdt * effectiveRate;
                                    const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
                                    const effectiveCostUsd = p.costUsd || (p.costBs && effectiveRate > 0 ? p.costBs / effectiveRate : 0);
                                    const margin = effectiveCostUsd > 0 && p.priceUsdt > 0 ? ((p.priceUsdt - effectiveCostUsd) / effectiveCostUsd * 100) : null;
                                    const catInfo = categories.find(c => c.id === p.category);
                                    return (
                                        <div key={p.id} className={`grid grid-cols-[auto_1fr_auto] sm:grid-cols-[40px_1fr_100px_100px_70px_80px_110px] gap-2 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${selectedIds.has(p.id) ? 'bg-brand/5 dark:bg-brand/10' : ''} ${isLowStock ? 'bg-amber-50/50 dark:bg-amber-900/5' : ''}`}>
                                            {/* Checkbox */}
                                            <div className="flex items-center justify-center px-1">
                                                <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => handleToggleSelect(p.id)} className="w-5 h-5 sm:w-4 sm:h-4 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer focus:ring-offset-0" />
                                            </div>
                                            
                                            {/* Product Info (always visible) */}
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                                                    <SmartImage
                                                        src={p.image}
                                                        product={p}
                                                        alt={p.name}
                                                        fallbackIcon={<Tag size={16} className="text-slate-300 dark:text-slate-600" />}
                                                    />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        {catInfo && catInfo.id !== 'todos' && (
                                                            <span className="text-[9px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{catInfo.label}</span>
                                                        )}
                                                        {isLowStock && <span className="text-[9px] font-bold text-amber-500 flex items-center gap-0.5"><AlertTriangle size={9} /> Bajo</span>}
                                                        {/* Mobile: show price inline */}
                                                        <span className="sm:hidden text-[11px] font-black text-emerald-600 dark:text-emerald-400">{copEnabled && copPrimary && tasaCop > 0 ? `${getCop(p, tasaCop).toLocaleString('es-CO')} COP` : `$${(getUsd(p, tasaCop) || 0).toFixed(2)}`}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Mobile: compact actions */}
                                            {/* v1.2.0: aria-label + aria-hidden en icon-only buttons (a11y). */}
                                            <div className="flex items-center gap-1.5 sm:hidden">
                                                <button onClick={() => handlePrintSingle(p)} aria-label={`Imprimir etiqueta de ${p.name}`} className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-surface-300 hover:text-brand transition-colors"><Printer size={14} aria-hidden="true" /></button>
                                                {!isCajero && (
                                                <div className="flex items-center bg-surface-50 dark:bg-surface-800 rounded-lg">
                                                    <button onClick={() => adjustStock(p.id, -1)} aria-label={`Restar 1 unidad de ${p.name}`} className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-surface-400 hover:text-red-500 transition-colors"><Minus size={14} aria-hidden="true" /></button>
                                                    <span className={`text-xs font-black min-w-[28px] text-center ${isLowStock ? 'text-amber-500' : 'text-surface-700 dark:text-surface-200'}`}>{formatStockDisplay(p.stock ?? 0, isGranelProduct(p))}</span>
                                                    <button onClick={() => adjustStock(p.id, 1)} aria-label={`Sumar 1 unidad de ${p.name}`} className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-surface-400 hover:text-emerald-500 transition-colors"><Plus size={14} aria-hidden="true" /></button>
                                                </div>
                                                )}
                                                {isCajero && <span className={`text-xs font-black ${isLowStock ? 'text-amber-500' : 'text-surface-700 dark:text-surface-200'}`}>{formatStockDisplay(p.stock ?? 0, isGranelProduct(p))}</span>}
                                                {!isCajero && <button onClick={() => handleEdit(p)} aria-label={`Editar ${p.name}`} className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-surface-300 hover:text-amber-500 transition-colors"><Pencil size={14} aria-hidden="true" /></button>}
                                            </div>

                                            {/* Desktop columns */}
                                            <div className="hidden sm:block">
                                                {copEnabled && tasaCop > 0 ? (
                                                    copPrimary ? (
                                                        <>
                                                            <p className="text-sm font-black text-amber-600 dark:text-amber-400">{getCop(p, tasaCop).toLocaleString('es-CO')} COP</p>
                                                            <p className="text-[10px] text-slate-400 font-medium">USD {getUsd(p, tasaCop).toFixed(2)}</p>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">${getUsd(p, tasaCop).toFixed(2)}</p>
                                                            <p className="text-[10px] text-slate-400 font-medium">{getCop(p, tasaCop).toLocaleString('es-CO')} COP</p>
                                                        </>
                                                    )
                                                ) : (
                                                    <>
                                                        <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">${(p.priceUsdt || 0).toFixed(2)}</p>
                                                        <p className="text-[10px] text-slate-400 font-medium">{formatBs(valBs)} Bs</p>
                                                    </>
                                                )}
                                            </div>
                                            <div className="hidden sm:block">
                                                {!isCajero ? <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{p.costUsd ? (copEnabled && copPrimary && tasaCop > 0 ? `${Math.round(p.costUsd * tasaCop).toLocaleString('es-CO')} COP` : `$${p.costUsd.toFixed(2)}`) : '-'}</p> : <span className="text-[10px] text-slate-300">-</span>}
                                            </div>
                                            <div className="hidden sm:block">
                                                {!isCajero ? (margin !== null ? (
                                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${margin >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
                                                        {margin >= 0 ? '+' : ''}{margin.toFixed(0)}%
                                                    </span>
                                                ) : <span className="text-[10px] text-slate-300">-</span>) : <span className="text-[10px] text-slate-300">-</span>}
                                            </div>
                                            <div className="hidden sm:flex items-center gap-1">
                                                {!isCajero && <button onClick={() => adjustStock(p.id, -1)} aria-label={`Restar 1 unidad de ${p.name}`} className="w-9 h-9 rounded-lg bg-surface-50 dark:bg-surface-800 flex items-center justify-center text-surface-400 hover:text-red-500 transition-colors active:scale-90"><Minus size={14} aria-hidden="true" /></button>}
                                                <span className={`text-sm font-black min-w-[32px] text-center ${isLowStock ? 'text-amber-500' : 'text-surface-700 dark:text-surface-200'}`}>{formatStockDisplay(p.stock ?? 0, isGranelProduct(p))}</span>
                                                {!isCajero && <button onClick={() => adjustStock(p.id, 1)} aria-label={`Sumar 1 unidad de ${p.name}`} className="w-9 h-9 rounded-lg bg-surface-50 dark:bg-surface-800 flex items-center justify-center text-surface-400 hover:text-emerald-500 transition-colors active:scale-90"><Plus size={14} aria-hidden="true" /></button>}
                                            </div>
                                            <div className="hidden sm:flex items-center justify-end gap-1">
                                                <button onClick={() => handlePrintSingle(p)} aria-label={`Imprimir etiqueta de ${p.name}`} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-surface-300 hover:text-brand hover:bg-brand/10 transition-all" title="Imprimir Etiqueta"><Printer size={14} aria-hidden="true" /></button>
                                                {!isCajero && <button onClick={() => handleEdit(p)} aria-label={`Editar ${p.name}`} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-surface-300 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all"><Pencil size={14} aria-hidden="true" /></button>}
                                                {!isCajero && <button onClick={() => handleDelete(p.id)} aria-label={`Eliminar ${p.name}`} className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"><Trash2 size={14} aria-hidden="true" /></button>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex justify-center items-center gap-4 py-4 shrink-0">
                                {/* v1.2.0: touch targets ≥ 48px (a11y WCAG AA) + surface tokens */}
                                <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1}
                                    className="p-2.5 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl bg-surface dark:bg-surface-900 border border-surface-200 dark:border-surface-800 disabled:opacity-50 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
                                    <ChevronLeft size={20} className="text-surface-600 dark:text-surface-400" aria-hidden="true" />
                                </button>
                                <span className="text-sm font-bold text-surface-500 dark:text-surface-400">Página {currentPage} de {totalPages}</span>
                                <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages}
                                    className="p-2.5 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl bg-surface dark:bg-surface-900 border border-surface-200 dark:border-surface-800 disabled:opacity-50 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
                                    <ChevronRight size={20} className="text-surface-600 dark:text-surface-400" aria-hidden="true" />
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ─── Modal Añadir / Editar ───────────────────────── */}
            <ProductFormModal
                isOpen={isModalOpen} onClose={handleClose} isEditing={!!editingId}
                image={image} setImage={setImage}
                name={name} setName={setName}
                barcode={barcode} setBarcode={setBarcode}
                category={category} setCategory={setCategory}
                unit={unit} setUnit={setUnit}
                priceUsd={priceUsd} handlePriceUsdChange={handlePriceUsdChange}
                priceBs={priceBs} handlePriceBsChange={handlePriceBsChange}
                pricingMode={pricingMode} setPricingMode={setPricingMode}
                priceBsUsdRef={priceBsUsdRef} setPriceBsUsdRef={setPriceBsUsdRef}
                handlePriceCopChange={handlePriceCopChange}
                priceCop={priceCop}
                costUsd={costUsd} handleCostUsdChange={handleCostUsdChange}
                costBs={costBs} handleCostBsChange={handleCostBsChange}
                costCop={costCop} handleCostCopChange={handleCostCopChange}
                stock={stock} setStock={setStock}
                lowStockAlert={lowStockAlert} setLowStockAlert={setLowStockAlert}
                unitsPerPackage={unitsPerPackage} setUnitsPerPackage={setUnitsPerPackage}
                sellByUnit={sellByUnit} setSellByUnit={setSellByUnit}
                unitPriceUsd={unitPriceUsd} setUnitPriceUsd={setUnitPriceUsd}
                unitPriceCop={unitPriceCop} setUnitPriceCop={setUnitPriceCop}
                packagingType={packagingType} setPackagingType={setPackagingType}
                stockInLotes={stockInLotes} setStockInLotes={setStockInLotes}
                granelUnit={granelUnit} setGranelUnit={setGranelUnit}
                effectiveRate={effectiveRate}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                tasaCop={tasaCop}
                isFormShaking={isFormShaking}
                handleImageUpload={handleImageUpload}
                handleSave={handleSave}
                categories={categories}
                productMovements={editingId ? productMovements : null}
            />

            {/* Ajuste por Lotes */}
            <StockBatchModal
                isOpen={isStockBatchOpen}
                onClose={() => setIsStockBatchOpen(false)}
                products={products}
                categories={categories}
                adjustStock={adjustStock}
                setProducts={setProducts}
                triggerHaptic={triggerHaptic}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
                copPrimary={copPrimary}
            />

            {/* Confirmación precio alto */}
            {highPriceConfirm && (
                // v1.2.0: surface tokens + shadow-tone-lg (warm shadow).
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
                    <div className="bg-surface dark:bg-surface-900 rounded-2xl p-6 max-w-sm w-full shadow-tone-lg">
                        <div className="flex flex-col items-center text-center space-y-3">
                            <div className="w-14 h-14 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center">
                                <AlertTriangle size={28} className="text-amber-500" aria-hidden="true" />
                            </div>
                            <h4 className="text-base font-black text-surface-700 dark:text-white">Precio inusualmente alto</h4>
                            <p className="text-sm text-surface-500 dark:text-surface-400">
                                El precio <span className="font-black text-amber-600">${highPriceConfirm.price.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span> parece muy elevado. ¿Es correcto o fue un error de tipeo?
                            </p>
                            <div className="flex gap-2 w-full pt-1">
                                {/* v1.2.0: touch targets ≥ 48px */}
                                <button
                                    onClick={() => setHighPriceConfirm(null)}
                                    className="flex-1 py-2.5 min-h-[48px] rounded-xl border border-surface-200 dark:border-surface-700 text-sm font-bold text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                                >
                                    Corregir
                                </button>
                                <button
                                    onClick={() => _commitSave(highPriceConfirm.pendingData)}
                                    className="flex-1 py-2.5 min-h-[48px] rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors"
                                >
                                    Sí, es correcto
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Share Modal */}
            <ProductShareModal
                isOpen={!!shareProduct} onClose={() => setShareProduct(null)}
                product={shareProduct} accounts={accounts} streetRate={streetRate}
                rates={{ ...rates, bcv: { ...rates.bcv, price: effectiveRate } }}
            />

            {/* Delete Modal */}
            <Modal isOpen={!!deleteId} onClose={() => setDeleteId(null)} title="Eliminar Producto">
                <div className="flex flex-col items-center text-center space-y-4 py-4">
                    <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-2">
                        <Trash2 size={32} className="text-red-500" aria-hidden="true" />
                    </div>
                    <div>
                        {/* v1.2.0: text tokens surface-* en vez de slate-* */}
                        <h4 className="text-lg font-bold text-surface-700 dark:text-white">¿Estás seguro?</h4>
                        <p className="text-sm text-surface-500 dark:text-surface-400 mt-1 px-4">Esta acción eliminará el producto permanentemente.</p>
                    </div>
                    <div className="flex gap-3 w-full pt-2">
                        {/* v1.2.0: touch targets ≥ 48px (a11y WCAG AA) */}
                        <button onClick={() => setDeleteId(null)} className="flex-1 py-3 min-h-[48px] text-sm font-bold text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-xl transition-colors">Cancelar</button>
                        <button onClick={confirmDelete} className="flex-1 py-3 min-h-[48px] text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-lg shadow-red-500/30 active:scale-95 transition-all">¡Sí, eliminar!</button>
                    </div>
                </div>
            </Modal>

            {/* Modal de Confirmación Borrado Total */}
            <Modal isOpen={isDeleteAllModalOpen} onClose={() => { setIsDeleteAllModalOpen(false); setDeleteAllConfirmText(''); }} title="⚠️ Borrado de Inventario">
                <div className="p-4 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/40 text-red-500 rounded-full flex items-center justify-center mb-4">
                        <Trash2 size={32} aria-hidden="true" />
                    </div>
                    {/* v1.2.0: text tokens surface-* en vez de slate-* */}
                    <h3 className="text-xl font-black text-surface-700 dark:text-white mb-2">¿Estás absolutamente seguro?</h3>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 px-2">
                        Esta acción borrará <strong className="text-red-500">{products.length} productos</strong> y no se puede deshacer. (No afectará tu historial de ventas).
                    </p>
                    <div className="w-full bg-surface-100 dark:bg-surface-800 p-4 rounded-xl border border-surface-200 dark:border-surface-700 mb-6">
                        <p className="text-xs font-bold text-surface-700 dark:text-surface-300 mb-2 uppercase tracking-wide">Para confirmar, escribe "BORRAR":</p>
                        <input
                            type="text"
                            value={deleteAllConfirmText}
                            onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                            placeholder="BORRAR"
                            className="w-full form-input bg-surface dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded-xl px-4 py-3 min-h-[48px] text-center font-black text-red-500 uppercase tracking-widest focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all outline-none"
                        />
                    </div>
                </div>
                <div className="p-4 border-t border-surface-100 dark:border-surface-800 bg-surface-100 dark:bg-surface-800/50 flex gap-3">
                    {/* v1.2.0: touch targets ≥ 48px + surface tokens */}
                    <button
                        onClick={() => {
                            triggerHaptic && triggerHaptic();
                            setIsDeleteAllModalOpen(false);
                            setDeleteAllConfirmText('');
                        }}
                        className="flex-1 py-3.5 min-h-[48px] bg-surface dark:bg-surface-800 border-2 border-surface-200 dark:border-surface-700 text-surface-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => {
                            triggerHaptic && triggerHaptic();
                            if (deleteAllConfirmText.trim().toUpperCase() === 'BORRAR') {
                                localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');
                                setProducts([]);
                                storageService.removeItem('bodega_products_v1');
                                setIsDeleteAllModalOpen(false);
                                setDeleteAllConfirmText('');
                            }
                        }}
                        disabled={deleteAllConfirmText.trim().toUpperCase() !== 'BORRAR'}
                        className="flex-1 py-3.5 min-h-[48px] bg-red-500 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white font-bold rounded-xl active:scale-[0.98] transition-all flex justify-center items-center gap-2"
                    >
                        <Trash2 size={18} aria-hidden="true" /> Borrar Todo
                    </button>
                </div>
            </Modal>



            <ShareInventoryModal
                isOpen={isShareOpen}
                onClose={() => setIsShareOpen(false)}
            />
            <BulkPriceAdjustModal
                isOpen={isBulkPriceOpen}
                onClose={() => setIsBulkPriceOpen(false)}
                products={products}
                setProducts={setProducts}
                categories={categories}
                activeCategory={activeCategory}
                effectiveRate={effectiveRate}
                triggerHaptic={triggerHaptic}
                showToast={showToast}
                copEnabled={copEnabled}
                copPrimary={copPrimary}
                tasaCop={tasaCop}
                selectedIds={selectedIds}
                onClearSelection={() => setSelectedIds(new Set())}
            />

            <CategoryManagerModal
                isOpen={isCategoryManagerOpen}
                onClose={() => setIsCategoryManagerOpen(false)}
                categories={categories}
                onAddCategory={handleAddCategory}
                onDeleteCategory={handleDeleteCategory}
                newCategoryIcon={newCategoryIcon}
                setNewCategoryIcon={setNewCategoryIcon}
                newCategoryName={newCategoryName}
                setNewCategoryName={setNewCategoryName}
            />

            {/* Modal Confirmación: Borrar Categoría */}
            <ConfirmModal
                isOpen={!!deleteCategoryConfirmId}
                onClose={() => setDeleteCategoryConfirmId(null)}
                onConfirm={confirmDeleteCategory}
                title="Eliminar categoría"
                message="¿Seguro que deseas borrar esta categoría? Los productos no se eliminarán, pero quedarán sin categoría asignada."
                confirmText="Sí, eliminar"
                variant="warning"
            />
        </div>
    );
};

export default ProductsView;
