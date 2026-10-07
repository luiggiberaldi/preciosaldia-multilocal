import { useState, useRef, useEffect } from 'react';
import { showToast } from '../components/Toast';

export function useVoiceSearch({ onResult, triggerHaptic }) {
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessingAudio, setIsProcessingAudio] = useState(false);
    const recognitionRef = useRef(null);
    // HOOK-019: Refs estables para que cleanup funcione aunque cambien los callbacks.
    const onResultRef = useRef(onResult);
    const triggerHapticRef = useRef(triggerHaptic);
    useEffect(() => { onResultRef.current = onResult; }, [onResult]);
    useEffect(() => { triggerHapticRef.current = triggerHaptic; }, [triggerHaptic]);

    // HOOK-019: Cleanup global al desmontar el componente: abortar reconocimiento
    // pendiente para liberar el micrófono y evitar callbacks tras unmount.
    useEffect(() => {
        return () => {
            if (recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch (_) { /* noop */ }
                recognitionRef.current = null;
            }
        };
    }, []);

    const startRecording = () => {
        if (isRecording) return;

        // Web Speech API (nativa del navegador, sin necesidad de API key)
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            showToast('Tu navegador no soporta búsqueda por voz.', 'warning');
            return;
        }

        try {
            const recognition = new SpeechRecognition();
            recognition.lang = 'es-VE';
            recognition.continuous = false;
            recognition.interimResults = true; // Permite ver resultados parciales
            recognition.maxAlternatives = 1;

            let finalTranscript = '';

            recognition.onstart = () => {
                setIsRecording(true);
                triggerHapticRef.current && triggerHapticRef.current();
            };

            recognition.onresult = (event) => {
                let interimTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }
                const currentText = finalTranscript || interimTranscript;
                const cleanText = currentText.replace(/[.,!?]$/, '').trim();
                
                if (cleanText) {
                    onResultRef.current(cleanText);
                }
            };

            recognition.onerror = (event) => {
                if (event.error === 'no-speech') {
                    showToast('No se detectó voz. Intenta de nuevo.', 'warning');
                } else if (event.error === 'not-allowed') {
                    showToast('Permiso de micrófono denegado. Actívalo en configuración.', 'warning');
                } else {
                    showToast('Error al procesar el audio. Inténtalo de nuevo.', 'error');
                }
                setIsRecording(false);
                setIsProcessingAudio(false);
            };

            recognition.onend = () => {
                setIsRecording(false);
                setIsProcessingAudio(false);
            };

            recognitionRef.current = recognition;
            setIsProcessingAudio(true);
            recognition.start();
        } catch (error) {
            showToast('No se pudo iniciar el reconocimiento de voz.', 'error');
            setIsRecording(false);
            setIsProcessingAudio(false);
        }
    };

    const stopRecording = () => {
        if (recognitionRef.current && isRecording) {
            recognitionRef.current.stop();
            setIsRecording(false);
        }
    };

    return { isRecording, isProcessingAudio, startRecording, stopRecording };
}
