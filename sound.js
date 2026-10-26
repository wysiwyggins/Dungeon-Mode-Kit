import { globalVars } from './globals.js';

// ============================================================================
// AUDIO MANAGER
// ============================================================================
// Handles sound effects using Howler.js audio sprites

export class AudioManager {
    constructor(audioSpriteData) {
        this.audioSpriteData = audioSpriteData;
        this.sound = null;
        this.muted = false;
        this.volume = 1.0;

        if (audioSpriteData) {
            this.initHowler();
        }
    }

    initHowler() {
        try {
            let urls = this.audioSpriteData.urls;

            // If URLs are relative and start with /, prepend BASE_PATH
            if (urls && urls.length > 0) {
                urls = urls.map(url => {
                    if (url.startsWith('/')) {
                        return globalVars.BASE_PATH + url;
                    }
                    return url;
                });
            } else {
                const basePath = `${globalVars.BASE_PATH}/assets/audio/effects`;
                const formats = ['mp3', 'ogg', 'm4a'];
                urls = formats.map(ext => `${basePath}.${ext}`);
            }

            console.log('Initializing audio with URLs:', urls);

            this.sound = new Howl({
                src: urls,
                sprite: this.audioSpriteData.sprite,
                volume: this.volume,
                onload: () => {
                    console.log('Audio sprite loaded successfully');
                },
                onloaderror: (id, error) => {
                    console.error('Audio loading error:', error);
                }
            });

            console.log('Howler initialized with', Object.keys(this.audioSpriteData.sprite).length, 'sound effects');
        } catch (error) {
            console.error('Failed to initialize Howler:', error);
            this.sound = null;
        }
    }

    play(soundName, options = {}) {
        if (!this.sound) {
            console.warn('Audio system not initialized');
            return;
        }

        if (this.muted) {
            return;
        }

        try {
            if (!this.audioSpriteData.sprite[soundName]) {
                console.warn(`Sound '${soundName}' not found in audio sprite`);
                return;
            }
            const id = this.sound.play(soundName);
            if (options.volume !== undefined) {
                this.sound.volume(options.volume * this.volume, id);
            }
            // Apply optional pitch/rate adjustment
            if (options.rate !== undefined) {
                this.sound.rate(options.rate, id);
            }

            return id;
        } catch (error) {
            console.warn(`Failed to play sound '${soundName}':`, error);
        }
    }

    playVaried(soundName, volumeBase = 0.5, volumeVariance = 0.15, rateBase = 1.0, rateVariance = 0.08) {
        // Play a sound with randomized volume and pitch for variety
        const volume = volumeBase + (Math.random() * 2 - 1) * volumeVariance;
        const rate = rateBase + (Math.random() * 2 - 1) * rateVariance;
        this.play(soundName, { volume, rate });
    }

    stop(soundName) {
        if (this.sound) {
            try {
                this.sound.stop(soundName);
            } catch (error) {
                console.warn(`Failed to stop sound '${soundName}':`, error);
            }
        }
    }

    mute() {
        this.muted = true;
        if (this.sound) {
            this.sound.mute(true);
        }
    }

    unmute() {
        this.muted = false;
        if (this.sound) {
            this.sound.mute(false);
        }
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
        if (this.sound) {
            this.sound.volume(this.volume);
        }
    }

    listSounds() {
        if (!this.audioSpriteData) {
            return [];
        }
        return Object.keys(this.audioSpriteData.sprite);
    }
}

// ============================================================================
// AUDIO DEBUG UTILITIES
// ============================================================================
// Console utilities for testing and debugging audio

window.audioDebug = {
    play: (soundName) => {
        if (!window.engine || !window.engine.audioManager) {
            console.error('Engine not initialized. Run initializeGame() first.');
            return;
        }
        window.engine.playSound(soundName);
    },

    list: () => {
        if (!window.engine || !window.engine.audioManager) {
            console.error('Engine not initialized. Run initializeGame() first.');
            return [];
        }
        const sounds = window.engine.listAvailableSounds();
        console.table(sounds.map(name => ({ sound: name })));
        return sounds;
    },

    volume: (vol) => {
        if (!window.engine || !window.engine.audioManager) {
            console.error('Engine not initialized. Run initializeGame() first.');
            return;
        }
        window.engine.setAudioVolume(vol);
        console.log(`Volume set to ${vol * 100}%`);
    },

    mute: () => {
        if (!window.engine || !window.engine.audioManager) {
            console.error('Engine not initialized. Run initializeGame() first.');
            return;
        }
        window.engine.muteAudio();
        console.log('Audio muted');
    },

    unmute: () => {
        if (!window.engine || !window.engine.audioManager) {
            console.error('Engine not initialized. Run initializeGame() first.');
            return;
        }
        window.engine.unmuteAudio();
        console.log('Audio unmuted');
    },

    test: () => {
        if (!window.engine || !window.engine.audioManager) {
            console.error('Engine not initialized. Run initializeGame() first.');
            return;
        }
        console.log('Playing test sequence...');
        const testSounds = ['feets', 'plunk1', 'tone1', 'bow', 'pickup'];
        testSounds.forEach((sound, i) => {
            setTimeout(() => {
                console.log(`Playing: ${sound}`);
                window.engine.playSound(sound);
            }, i * 600);
        });
    }
};
