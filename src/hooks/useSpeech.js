import { useState, useCallback, useEffect, useRef } from 'react';

export const useSpeech = () => {
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const [voices, setVoices] = useState([]);
    const voicesLoaded = useRef(false);

    // Cargar voces dinámicamente (Chrome/Android a veces tardan)
    // HOOK-027: usar addEventListener/removeEventListener en vez del handler
    // directo `onvoiceschanged` que está deprecado y era limpiado a `null`
    // (no removía el listener real en algunos navegadores).
    useEffect(() => {
        const synth = window.speechSynthesis;
        if (!synth) return;

        const loadVoices = () => {
            const availVoices = synth.getVoices();
            if (availVoices.length > 0) {
                setVoices(availVoices);
                voicesLoaded.current = true;
            }
        };

        loadVoices();
        synth.addEventListener('voiceschanged', loadVoices);
        return () => {
            synth.removeEventListener('voiceschanged', loadVoices);
        };
    }, []);

    const speak = useCallback((text) => {
        if (!voiceEnabled || !window.speechSynthesis) return;

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);

        // Estrategia: TASAS AL DÍA (Voz Masculina)
        // 1. Microsoft Raul (Windows - La mejor)
        // 2. Google Español (Suele ser mujer, pero bajaremos el pitch)
        let selectedVoice =
            voices.find(v => v.name.includes('Microsoft Raul')) ||
            voices.find(v => v.name === 'Google español de Estados Unidos') ||
            voices.find(v => v.name === 'Google español') ||
            voices.find(v => v.lang === 'es-MX') ||
            voices.find(v => v.lang === 'es-419');

        if (selectedVoice) utterance.voice = selectedVoice;

        // [EFECTO DE VOZ] Masculinización
        // Bajamos el pitch para que incluso una voz femenina suene más grave/masculina
        // 1.0 = Normal. 0.7-0.8 = Masculino/Grave.
        utterance.pitch = selectedVoice?.name?.includes('Raul') ? 0.9 : 0.75;
        utterance.rate = 1.1; // Velocidad fluida

        window.speechSynthesis.speak(utterance);
    }, [voiceEnabled, voices]);

    return { voiceEnabled, setVoiceEnabled, speak };
};
