import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_CLOUD_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_CLOUD_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function getSlug(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export default async function handler(req, res) {
    const origin = req.headers?.origin || '';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const query = req.query.q;

        if (!query || query.trim().length < 3) {
            return res.status(400).json({ error: "Falta el parámetro 'q' de búsqueda (mínimo 3 caracteres)." });
        }

        const trimmedQuery = query.trim();
        const slug = getSlug(trimmedQuery);

        // 1. Intentar coincidencia exacta de slug
        const { data: exactMatch } = await supabase
            .from("product_images_catalog")
            .select("name, image_url")
            .eq("id", slug)
            .maybeSingle();

        if (exactMatch) {
            return res.status(200).json({
                success: true,
                matches: [{ title: exactMatch.name, dataUri: exactMatch.image_url }]
            });
        }

        // 2. Intentar coincidencia parcial por etiquetas (tags)
        const words = trimmedQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (words.length > 0) {
            const { data: matches } = await supabase
                .from("product_images_catalog")
                .select("id, name, image_url")
                .overlaps("tags", words);

            if (matches && matches.length > 0) {
                const ranked = matches.map(item => {
                    let score = 0;
                    const nameLower = item.name.toLowerCase();
                    words.forEach(w => {
                        if (nameLower.includes(w)) score += 10;
                    });
                    return { ...item, score };
                })
                .filter(item => item.score > 0)
                .sort((a, b) => b.score - a.score);

                if (ranked.length > 0) {
                    const topMatches = ranked.slice(0, 5).map(item => ({
                        title: item.name,
                        dataUri: item.image_url
                    }));
                    return res.status(200).json({ success: true, matches: topMatches });
                }
            }
        }

        return res.status(404).json({ error: "No se encontraron imágenes en el catálogo para el producto especificado." });

    } catch (error) {
        console.error("[CatalogSearch] Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
