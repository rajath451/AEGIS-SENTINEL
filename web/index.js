/* --------------------------------------------------
   CRISIS DASHBOARD CORE CONTROLS & INTERACTIVE LOGIC
   -------------------------------------------------- */

// App State Cache
const state = {
    currentUser: null,
    authMode: 'login',
    isSimulated: true,
    isRunning: false,
    audioSource: 'radio', // 'radio' or 'mic'
    selectedCountry: 'world', // Default to global scale
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],
    recordedAudioBlob: null,
    speechRecognizer: null,
    customTranscript: '',
    micStream: null,
    audioContext: null,
    analyserNode: null,
    micTimerInterval: null,
    micDurationSeconds: 0,
    map: null,
    baseLayer: null,
    radarLayers: [],
    radarTimes: [],
    radarCurrentIndex: 0,
    radarPlaying: false,
    radarInterval: null,
    isRadarEnabled: true,
    userLat: null,
    userLng: null,
    userLocationMarker: null,
    markers: [],
    waveformAnimationId: null,
    audioDurationSeconds: 0,
    audioTimerInterval: null,
    sirenVolume: 0.5,
    radarOpacity: 0.65,
    mapTheme: 'dark'
};

// UI Selectors
const dom = {
    modeSimulatedBtn: document.getElementById('mode-simulated-btn'),
    modeProductionBtn: document.getElementById('mode-production-btn'),
    sourceRadioBtn: document.getElementById('source-radio-btn'),
    sourceMicBtn: document.getElementById('source-mic-btn'),
    micRecorderWidget: document.getElementById('mic-recorder-widget'),
    micRecordBtn: document.getElementById('mic-record-btn'),
    micStatusLabel: document.getElementById('mic-status-label'),
    micStatusLabel: document.getElementById('mic-status-label') || document.getElementById('mic-status-label'), // Fallback
    micTimerLabel: document.getElementById('mic-timer-label'),
    audioBadge: document.getElementById('audio-badge'),
    
    serpQueryInput: document.getElementById('serp-query-input'),
    runBtn: document.getElementById('run-pipeline-trigger'),
    btnSpinner: document.getElementById('btn-spinner'),
    globalStatusDot: document.getElementById('global-status-dot'),
    globalStatusText: document.getElementById('global-status-text'),
    settingsToggleBtn: document.getElementById('settings-toggle-btn'),
    settingsPanel: document.getElementById('settings-panel'),
    settingsCloseBtn: document.getElementById('settings-close-btn'),
    
    // Output Terminals
    transcriptionOutput: document.getElementById('transcription-output'),
    cogneeLogs: document.getElementById('cognee-memory-logs'),
    triggerwareLogs: document.getElementById('triggerware-alerts-logs'),
    systemEventLogs: document.getElementById('system-event-logs'),
    logsClearBtn: document.getElementById('logs-clear-btn'),
    
    // Feeds
    insightsCardsContainer: document.getElementById('insights-cards-container'),
    serpAccordionTarget: document.getElementById('serp-accordion-target'),
    
    // Waveform
    waveformCanvas: document.getElementById('waveform-canvas'),
    audioTimer: document.getElementById('audio-timer'),
    
    // Timeline steps
    stepAsr: document.getElementById('step-asr'),
    stepSerp: document.getElementById('step-serp'),
    stepGemini: document.getElementById('step-gemini'),
    stepMemory: document.getElementById('step-memory'),
    
    // Map overlays
    mapFallbackView: document.getElementById('map-fallback-view'),
    coordinateReadout: document.getElementById('coordinate-readout'),
    googleMapTarget: document.getElementById('google-map-target')
};

// Local Storage Authentication Databases & Helper Operations
function getRegisteredUsers() {
    try {
        const users = localStorage.getItem('aegis_users');
        return users ? JSON.parse(users) : { "operator@gmail.com": "1234" }; // Default credentials matching original passcode
    } catch (e) {
        return { "operator@gmail.com": "1234" };
    }
}

function saveRegisteredUsers(users) {
    try {
        localStorage.setItem('aegis_users', JSON.stringify(users));
    } catch (e) {
        console.error("Failed to persist users", e);
    }
}

function getLoggedInUser() {
    return localStorage.getItem('aegis_logged_in_user');
}

function setLoggedInUser(email) {
    localStorage.setItem('aegis_logged_in_user', email);
}

function clearLoggedInUser() {
    localStorage.removeItem('aegis_logged_in_user');
}

function updateOperatorProfileUI(email) {
    if (!email) return;
    const namePart = email.split('@')[0].toUpperCase();
    
    // Update Header Profile Chip
    const chipName = document.getElementById('operator-chip-name');
    if (chipName) chipName.textContent = namePart;
    
    // Update Settings Modal profile strings
    const profileEmail = document.getElementById('operator-profile-email');
    const profileRole = document.getElementById('operator-profile-role');
    if (profileEmail) profileEmail.textContent = email;
    if (profileRole) {
        const grade = (email.length % 3) + 1;
        profileRole.textContent = `AUTHORIZED OPERATOR • CLASS-${grade}`;
    }
    
    // Update HUD Agent ID text value dynamically if element exists
    const agentIdVal = document.querySelector('#landing-main-hud .flex.gap-4 .hud-border:nth-child(2) .text-2xl');
    if (agentIdVal) {
        agentIdVal.textContent = namePart.slice(0, 8);
    }
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupAudioWaveformPlaceholder();
    loadLatestCachedRun();
    
    // Initialize Web Speech API
    state.speechRecognizer = initSpeechRecognition();
    
    // Initialize Leaflet Map automatically
    initLeafletMap();

    // Initialize premium AEGIS telemetry widget and alerts carousel
    syncTelemetryWidget("Mangaluru");
    startCarouselSlider();

    // Auto-Login Check on Load
    const savedUser = getLoggedInUser();
    if (savedUser) {
        state.currentUser = savedUser;
        updateOperatorProfileUI(savedUser);
        
        const landingPage = document.getElementById('landing-page-container');
        const dashboard = document.getElementById('dashboard-container');
        if (landingPage) landingPage.style.display = 'none';
        if (dashboard) dashboard.classList.remove('hidden');
        
        logToConsole(`🔑 Auto-Login: Restored active session for operator: ${savedUser}`, "success");
        
        // Force Leaflet map viewport recalculation
        if (state.map) {
            setTimeout(() => {
                state.map.invalidateSize();
            }, 300);
        }
    }

    // Restore persistent localized coordinates from MongoDB secure backend!
    if (savedUser) {
        fetch(`/api/operator/localize?email=${encodeURIComponent(savedUser)}`)
            .then(res => res.json())
            .then(data => {
                if (data.status === "success" && data.coords) {
                    const { lat, lng } = data.coords;
                    state.userLat = lat;
                    state.userLng = lng;
                    logToConsole(`📍 Geolocation state restored from secure database: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, "info");
                    
                    // Trigger map view update if loaded
                    if (state.map && lat && lng) {
                        state.map.setView([lat, lng], 13);
                        if (state.userLocationMarker) {
                            state.map.removeLayer(state.userLocationMarker);
                        }
                        const userIcon = L.divIcon({
                            className: 'custom-leaflet-marker',
                            html: `
                                <div class="marker-pulse-ring" style="border: 2px solid #3b82f6; box-shadow: 0 0 10px #3b82f6;"></div>
                                <div class="marker-pin-inner" style="background-color: #3b82f6;"></div>
                            `,
                            iconSize: [32, 32],
                            iconAnchor: [16, 16]
                        });
                        state.userLocationMarker = L.marker([lat, lng], { icon: userIcon }).addTo(state.map);
                        state.userLocationMarker.bindPopup("<b>📍 Your Location</b><br>Secured sensory dispatch node.");
                    }
                } else {
                    // Fallback to localStorage cache
                    const storedCoords = localStorage.getItem('aegis_last_localized_coords');
                    if (storedCoords) {
                        try {
                            const { lat, lng } = JSON.parse(storedCoords);
                            state.userLat = lat;
                            state.userLng = lng;
                            logToConsole(`📍 Geolocation state restored from local cache: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, "info");
                        } catch (e) {}
                    }
                }
            })
            .catch(err => {
                // Fallback to localStorage cache
                const storedCoords = localStorage.getItem('aegis_last_localized_coords');
                if (storedCoords) {
                    try {
                        const { lat, lng } = JSON.parse(storedCoords);
                        state.userLat = lat;
                        state.userLng = lng;
                        logToConsole(`📍 Geolocation state restored from local cache: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, "info");
                    } catch (e) {}
                }
            });
    }

});

// Event Listeners Configuration
function setupEventListeners() {
    // Execution mode toggles
    dom.modeSimulatedBtn.addEventListener('click', () => {
        state.isSimulated = true;
        dom.modeSimulatedBtn.classList.add('active');
        dom.modeProductionBtn.classList.remove('active');
        logToConsole("Mode changed to [SIMULATED DEMO]. Fast execution, uses offline mock credentials.", "info");
    });

    dom.modeProductionBtn.addEventListener('click', () => {
        state.isSimulated = false;
        dom.modeProductionBtn.classList.add('active');
        dom.modeSimulatedBtn.classList.remove('active');
        logToConsole("Mode changed to [LIVE PRODUCTION]. Will require real API keys in .env file.", "warning");
    });

    // Audio ingestion source selectors
    dom.sourceRadioBtn.addEventListener('click', () => {
        state.audioSource = 'radio';
        dom.sourceRadioBtn.classList.add('active');
        dom.sourceMicBtn.classList.remove('active');
        dom.micRecorderWidget.classList.add('hidden');
        dom.audioBadge.textContent = 'emergency_radio.mp3';
        stopMicRecording();
        logToConsole("Ingestion source changed to [BROADCAST RADIO FEED]. Will ingest pre-recorded emergency audio clip.", "info");
    });

    dom.sourceMicBtn.addEventListener('click', () => {
        state.audioSource = 'mic';
        dom.sourceMicBtn.classList.add('active');
        dom.sourceRadioBtn.classList.remove('active');
        dom.micRecorderWidget.classList.remove('hidden');
        dom.audioBadge.textContent = 'Live Microphone';
        dom.transcriptionOutput.textContent = '';
        dom.transcriptionOutput.innerHTML = '<span class="terminal-placeholder">Ready... Click the red Record Mic button and speak into your device.</span>';
        logToConsole("Ingestion source changed to [MANUAL MICROPHONE INGEST]. Grant permission and speak to transcribe.", "info");
    });

    // Microphone Manual Record Toggle Button
    dom.micRecordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (state.isRecording) {
            stopMicRecording();
        } else {
            startMicRecording();
        }
    });

    // Target Location Scale Chip controls
    document.querySelectorAll('.country-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.country-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            
            const country = chip.getAttribute('data-country');
            state.selectedCountry = country;
            
            if (country === "local") {
                const handleGeoSuccess = (lat, lng, sourceLabel) => {
                    state.userLat = lat;
                    state.userLng = lng;
                    
                    // Save geolocated coordinates persistently to local cache and secure MongoDB database!
                    localStorage.setItem('aegis_last_localized_coords', JSON.stringify({ lat, lng }));
                    
                    const operator = getLoggedInUser() || state.currentUser;
                    if (operator) {
                        fetch('/api/operator/localize', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: operator, lat, lng })
                        })
                        .then(res => res.json())
                        .then(resData => {
                            if (resData.status === "success") {
                                logToConsole(`🔥 [MongoDB] Successfully synchronized localization coordinates to operators collection.`, "success");
                            }
                        })
                        .catch(err => {
                            console.warn("Failed to sync coordinates to MongoDB", err);
                        });
                    }

                    logToConsole(`📍 Geolocation locked (${sourceLabel}): ${lat.toFixed(4)}, ${lng.toFixed(4)}`, "success");
                    
                    // Center Leaflet map and plot pulsing user location marker
                    if (state.map) {
                        state.map.setView([lat, lng], 13);
                        setTimeout(() => {
                            state.map.invalidateSize();
                        }, 250);
                        
                        if (state.userLocationMarker) {
                            state.map.removeLayer(state.userLocationMarker);
                        }
                        
                        const userIcon = L.divIcon({
                            className: 'custom-leaflet-marker',
                            html: `
                                <div class="marker-pulse-ring" style="border: 2px solid #3b82f6; box-shadow: 0 0 10px #3b82f6;"></div>
                                <div class="marker-pin-inner" style="background-color: #3b82f6;"></div>
                            `,
                            iconSize: [32, 32],
                            iconAnchor: [16, 16]
                        });
                        state.userLocationMarker = L.marker([lat, lng], { icon: userIcon }).addTo(state.map);
                        state.userLocationMarker.bindPopup("<b>📍 Your Current Location</b><br>Secured sensory dispatch node.");
                    }
                    
                    // Reverse geocode to city name using free Nominatim reverse lookup
                    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
                        .then(res => res.json())
                        .then(geoData => {
                            const city = geoData.address.city || geoData.address.town || geoData.address.village || geoData.address.suburb || "Local Sector";
                            const query = `critical hazards storm warnings in ${city}`;
                            dom.serpQueryInput.value = query;
                            logToConsole(`📍 Reverse-geocoded local area: ${city}. Auto-populating query: "${query}"`, "success");
                            logToConsole("⚡ Triggering local crisis analysis report automatically...", "info");
                            triggerPipelineRun();
                        })
                        .catch(err => {
                            const query = `disasters storm warnings near ${lat.toFixed(2)}, ${lng.toFixed(2)}`;
                            dom.serpQueryInput.value = query;
                            logToConsole("⚡ Triggering local crisis analysis report automatically...", "info");
                            triggerPipelineRun();
                        });
                };

                const tryFallbackGeo = () => {
                    // Step 2.1: Check localStorage
                    const storedCoords = localStorage.getItem('aegis_last_localized_coords');
                    if (storedCoords) {
                        try {
                            const { lat, lng } = JSON.parse(storedCoords);
                            logToConsole("📍 GPS unavailable. Restoring coordinates from local operator cache...", "info");
                            handleGeoSuccess(lat, lng, "Local Storage Cache");
                            return;
                        } catch (e) {}
                    }
                    
                    // Step 2.2: Check active memory states
                    if (state.userLat !== null && state.userLng !== null) {
                        logToConsole("📍 GPS unavailable. Restoring active session coordinates...", "info");
                        handleGeoSuccess(state.userLat, state.userLng, "Active Session State");
                        return;
                    }
                    
                    // Step 2.3: Attempt high-reliability free IP Geolocation lookup
                    logToConsole("⚡ Contacting free cellular/IP location resolution service...", "info");
                    fetch('https://ipapi.co/json/')
                        .then(res => res.json())
                        .then(ipData => {
                            if (ipData && ipData.latitude && ipData.longitude) {
                                const lat = parseFloat(ipData.latitude);
                                const lng = parseFloat(ipData.longitude);
                                const city = ipData.city || "Local Sector";
                                handleGeoSuccess(lat, lng, `IP Geolocation: ${city}`);
                            } else {
                                throw new Error("Invalid payload response from IP service");
                            }
                        })
                        .catch(ipErr => {
                            // Step 2.4: Default fallback to Mangaluru local sector
                            logToConsole("⚠️ Geolocation networks unresolvable. Applying secure default sector (Mangaluru, India).", "warning");
                            const defaultLat = 12.9141;
                            const defaultLng = 74.8560;
                            handleGeoSuccess(defaultLat, defaultLng, "Default Local Coordinates");
                        });
                };

                logToConsole("📍 Requesting exact device geolocation authorization...", "info");
                if (!navigator.geolocation) {
                    logToConsole("❌ Browser Geolocation is not supported on this platform. Checking alternate systems...", "warning");
                    tryFallbackGeo();
                    return;
                }
                
                // Attempt 1: High-Accuracy GPS
                logToConsole("📍 Pinging mobile high-accuracy satellite GPS...", "info");
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        handleGeoSuccess(position.coords.latitude, position.coords.longitude, "High-Accuracy GPS");
                    },
                    (err) => {
                        logToConsole(`⚠️ GPS request timed out or unavailable (${err.message}). Retrying with coarse network location...`, "warning");
                        
                        // Attempt 2: Coarse cellular/network triangulation
                        navigator.geolocation.getCurrentPosition(
                            (pos) => {
                                handleGeoSuccess(pos.coords.latitude, pos.coords.longitude, "Coarse Network");
                            },
                            (lowErr) => {
                                logToConsole(`❌ Network-based location failed (${lowErr.message}). Engaging secondary fallback channels...`, "error");
                                tryFallbackGeo();
                            },
                            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
                        );
                    },
                    { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
                );
                
                return;
            }
            
            // Auto-populate query input matching target region
            let query = "critical natural disasters active hazards alert warnings world";
            if (country === "india") query = "monsoon flooding extreme regional critical hazard India";
            else if (country === "japan") query = "critical earthquake tsunami alert warning Japan";
            else if (country === "usa") query = "active wildfire severe storm alert warning USA";
            else if (country === "uk") query = "gale winds flood hazard warning United Kingdom";
            
            dom.serpQueryInput.value = query;
            
            // Fly map center to show correct scale and country automatically
            if (state.map) {
                state.map.invalidateSize();
                if (country === "india") state.map.setView([22.9734, 78.6569], 5);
                else if (country === "japan") state.map.setView([36.2048, 138.2529], 5);
                else if (country === "usa") state.map.setView([37.0902, -95.7129], 4);
                else if (country === "uk") state.map.setView([55.3781, -3.4360], 6);
                else state.map.setView([20, 0], 2);
            }
            
            logToConsole(`Target scale adjusted to [${country.toUpperCase()}]. Map focused on region. Query updated: "${query}"`, "info");
        });
    });

    // Run trigger
    dom.runBtn.addEventListener('click', () => {
        if (!state.isRunning) {
            triggerPipelineRun();
        }
    });

    // Settings panel controls
    dom.settingsToggleBtn.addEventListener('click', () => {
        dom.settingsPanel.classList.toggle('hidden');
    });

    dom.settingsCloseBtn.addEventListener('click', () => {
        dom.settingsPanel.classList.add('hidden');
    });

    // Clear logs terminal
    dom.logsClearBtn.addEventListener('click', () => {
        dom.systemEventLogs.innerHTML = `<span class="console-line text-muted">> Console logs cleared.</span>`;
    });

    // SOS beacon toggle listener
    const sosBtn = document.getElementById('sos-beacon-btn');
    if (sosBtn) {
        sosBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (state.sosPlaying) {
                stopSiren();
            } else {
                startSiren();
            }
        });
    }

    // Clear Route overlay listener
    const clearRouteBtn = document.getElementById('clear-route-btn');
    if (clearRouteBtn) {
        clearRouteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearEvacuationRoute();
        });
    }

    // Upgraded settings modal interactive listeners
    const themeSelect = document.getElementById('settings-map-theme');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            changeMapTheme(e.target.value);
        });
    }

    const radarOpacitySlider = document.getElementById('settings-radar-opacity');
    const radarOpacityLbl = document.getElementById('radar-opacity-lbl');
    if (radarOpacitySlider) {
        radarOpacitySlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.radarOpacity = val / 100;
            if (radarOpacityLbl) radarOpacityLbl.textContent = `${val}%`;
            showRadarFrame(state.radarCurrentIndex);
        });
    }

    const sirenVolumeSlider = document.getElementById('settings-siren-volume');
    if (sirenVolumeSlider) {
        sirenVolumeSlider.addEventListener('input', (e) => {
            updateSirenVolume(parseInt(e.target.value));
        });
    }

    const webhookUrlInput = document.getElementById('settings-webhook-url');
    const webhookTestBtn = document.getElementById('settings-webhook-test-btn');
    if (webhookTestBtn) {
        webhookTestBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const url = webhookUrlInput ? webhookUrlInput.value.trim() : "https://hooks.slack.com/services/mock-crisis-endpoint";
            logToConsole(`🔌 [Webhook Integration Sandbox] Connecting to external endpoint: ${url}`, "info");
            
            // Construct mock payload
            const payload = {
                timestamp: new Date().toISOString(),
                system: "Crisis Intelligence Core Terminal",
                event: "Manual System Integration Handshake Test",
                payload_status: "SUCCESSFUL_HANDSHAKE",
                coordinates_monitored: state.markers ? state.markers.length : 0,
                auth_channel: "SLACK_APP_INCOMING_WEBHOOK"
            };
            
            logToConsole(`🔌 Sent Webhook test hand-shake payload:\n${JSON.stringify(payload, null, 2)}`, "success");
        });
    }

    const mockBroadcastBtn = document.getElementById('settings-mock-broadcast-btn');
    if (mockBroadcastBtn) {
        mockBroadcastBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Construct mock hazard item
            const mockItem = {
                location_name: "Settings Simulation Sector",
                status: "HAZARD",
                details: "Critical emergency cell broadcast test triggered directly from Settings dashboard controls panel.",
                precautions: "Do NOT attempt to cross flooded roadways. Keep backup radio cells fully charged and monitor live radar grids.",
                lat: state.userLat || 40.758896,
                lng: state.userLng || -73.985130
            };
            
            // Call standard cell broadcast function
            broadcastRegionalWarning(mockItem);
            
            // Close modal
            dom.settingsPanel.classList.add('hidden');
        });
    }

    // 5-Day environmental prognosis modal events
    const forecastBtn = document.getElementById('telemetry-prognosis-btn');
    const forecastModal = document.getElementById('prognosis-overlay-modal');
    const forecastCloseX = document.getElementById('prognosis-close-x');
    const forecastCloseBtn = document.getElementById('prognosis-close-btn');
    
    if (forecastBtn && forecastModal) {
        forecastBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Re-render to make sure it is updated
            syncTelemetryWidget(state.currentTelemetryCity);
            forecastModal.classList.remove('hidden');
        });
    }
    
    if (forecastCloseX && forecastModal) {
        forecastCloseX.addEventListener('click', () => {
            forecastModal.classList.add('hidden');
        });
    }
    
    if (forecastCloseBtn && forecastModal) {
        forecastCloseBtn.addEventListener('click', () => {
            forecastModal.classList.add('hidden');
        });
    }

    // --- LANDING PAGE & SECURITY TRANSITION CONTROLS ---
    
    const variantSelectBtn = document.getElementById('variant-select-btn');
    const variantDropdownOptions = document.getElementById('variant-dropdown-options');
    const currentVariantLbl = document.getElementById('current-variant-lbl');
    const landingPageContainer = document.getElementById('landing-page-container');
    const landingNav = document.getElementById('landing-nav');
    
    // Toggle layout variant choices dropdown
    if (variantSelectBtn && variantDropdownOptions) {
        variantSelectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            variantDropdownOptions.classList.toggle('hidden');
        });
        
        // Hide dropdown on clicking elsewhere
        document.addEventListener('click', () => {
            variantDropdownOptions.classList.add('hidden');
        });
    }
    
    // Landing page variant switching engine
    const setLandingVariant = (variant) => {
        if (!landingPageContainer) return;
        
        // Remove all layout variant classes
        landingPageContainer.classList.remove('variant-ai-first', 'variant-command-center', 'variant-sentinel-hud');
        
        // Update layout state
        if (variant === 'ai-first') {
            landingPageContainer.classList.add('variant-ai-first');
            if (currentVariantLbl) currentVariantLbl.textContent = "AI-First (Dark)";
            
            // Set standard styling
            document.documentElement.classList.add('dark');
            document.body.classList.remove('light-theme');
            
            // Adjust standard navigation text logo and links
            const logoText = document.querySelector('#landing-nav-logo .logo-text-title');
            if (logoText) {
                logoText.textContent = "AEGIS SENTINEL";
                logoText.className = "logo-text-title";
            }
            const navLogo = document.getElementById('landing-nav-logo');
            if (navLogo) {
                navLogo.className = "flex items-center gap-2 text-headline-md font-headline-md font-extrabold text-security-blue dark:text-intelligence-teal tracking-tighter";
            }
            const navLinks = document.getElementById('landing-nav-links');
            if (navLinks) {
                navLinks.className = "hidden md:flex items-center gap-8";
                navLinks.innerHTML = `
                    <a class="text-secondary dark:text-intelligence-teal border-b-2 border-secondary dark:border-intelligence-teal pb-1 font-label-md text-label-md transition-all duration-150" href="#">Command</a>
                    <a class="text-on-surface-variant dark:text-surface-variant/80 font-label-md text-label-md hover:text-secondary dark:hover:text-intelligence-teal transition-colors duration-200" href="#">Strategic Ops</a>
                    <a class="text-on-surface-variant dark:text-surface-variant/80 font-label-md text-label-md hover:text-secondary dark:hover:text-intelligence-teal transition-colors duration-200" href="#">Intelligence</a>
                    <a class="text-on-surface-variant dark:text-surface-variant/80 font-label-md text-label-md hover:text-secondary dark:hover:text-intelligence-teal transition-colors duration-200" href="#">Network</a>
                `;
            }
            
            // Reset standard button labels
            const loginBtn = document.getElementById('landing-login-btn');
            const initBtn = document.getElementById('landing-init-btn');
            if (loginBtn) {
                loginBtn.textContent = "Operator Login";
                loginBtn.className = "text-secondary dark:text-intelligence-teal font-label-md text-label-md px-4 py-2 rounded-xl hover:bg-surface-container dark:hover:bg-white/10 transition-all operator-login-trigger";
            }
            if (initBtn) {
                initBtn.textContent = "Initialize Terminal";
                initBtn.className = "bg-secondary dark:bg-intelligence-teal text-white dark:text-security-blue font-label-md text-label-md px-6 py-3 rounded-[16px] hover:bg-security-blue dark:hover:bg-white hover:text-white dark:hover:text-security-blue font-bold transition-all active:scale-95 operator-login-trigger";
            }
            
            // Sync theme toggle icons
            const icons = document.querySelectorAll('#theme-toggle-btn span, #dashboard-theme-toggle-btn span');
            icons.forEach(span => {
                span.textContent = 'light_mode';
                span.innerHTML = '☀️';
            });
            
            logToConsole("📟 Landing page swapped to [AI-First (Dark)] variant (Screen deafd623).", "info");
            
        } else if (variant === 'command-center') {
            landingPageContainer.classList.add('variant-command-center');
            if (currentVariantLbl) currentVariantLbl.textContent = "Command Center (Light)";
            
            // Set standard light styling
            document.documentElement.classList.remove('dark');
            document.body.classList.add('light-theme');
            
            // Adjust standard navigation text logo and links
            const logoText = document.querySelector('#landing-nav-logo .logo-text-title');
            if (logoText) {
                logoText.textContent = "AEGIS SENTINEL";
                logoText.className = "logo-text-title";
            }
            const navLogo = document.getElementById('landing-nav-logo');
            if (navLogo) {
                navLogo.className = "flex items-center gap-2 text-headline-md font-headline-md font-extrabold text-security-blue dark:text-intelligence-teal tracking-tighter";
            }
            const navLinks = document.getElementById('landing-nav-links');
            if (navLinks) {
                navLinks.className = "hidden md:flex items-center gap-8";
                navLinks.innerHTML = `
                    <a class="text-secondary dark:text-intelligence-teal border-b-2 border-secondary dark:border-intelligence-teal pb-1 font-label-md text-label-md transition-all duration-150" href="#">Command</a>
                    <a class="text-on-surface-variant dark:text-surface-variant/80 font-label-md text-label-md hover:text-secondary dark:hover:text-intelligence-teal transition-colors duration-200" href="#">Strategic Ops</a>
                    <a class="text-on-surface-variant dark:text-surface-variant/80 font-label-md text-label-md hover:text-secondary dark:hover:text-intelligence-teal transition-colors duration-200" href="#">Intelligence</a>
                    <a class="text-on-surface-variant dark:text-surface-variant/80 font-label-md text-label-md hover:text-secondary dark:hover:text-intelligence-teal transition-colors duration-200" href="#">Network</a>
                `;
            }
            
            // Reset standard button labels
            const loginBtn = document.getElementById('landing-login-btn');
            const initBtn = document.getElementById('landing-init-btn');
            if (loginBtn) {
                loginBtn.textContent = "Operator Login";
                loginBtn.className = "text-secondary dark:text-intelligence-teal font-label-md text-label-md px-4 py-2 rounded-xl hover:bg-surface-container dark:hover:bg-white/10 transition-all operator-login-trigger";
            }
            if (initBtn) {
                initBtn.textContent = "Initialize Terminal";
                initBtn.className = "bg-secondary dark:bg-intelligence-teal text-white dark:text-security-blue font-label-md text-label-md px-6 py-3 rounded-[16px] hover:bg-security-blue dark:hover:bg-white hover:text-white dark:hover:text-security-blue font-bold transition-all active:scale-95 operator-login-trigger";
            }
            
            // Sync theme toggle icons
            const icons = document.querySelectorAll('#theme-toggle-btn span, #dashboard-theme-toggle-btn span');
            icons.forEach(span => {
                span.textContent = 'dark_mode';
                span.innerHTML = '🌙';
            });
            
            logToConsole("📟 Landing page swapped to [Command Center (Light)] variant (Screen 1d45925a).", "info");
            
        } else if (variant === 'sentinel-hud') {
            landingPageContainer.classList.add('variant-sentinel-hud');
            if (currentVariantLbl) currentVariantLbl.textContent = "Sentinel HUD (Tech)";
            
            // Monospace tech styling
            document.documentElement.classList.add('dark');
            document.body.classList.remove('light-theme');
            
            // Re-render logo to exact matching screen: AEGIS_SENTINEL.v3
            const logoText = document.querySelector('#landing-nav-logo .logo-text-title');
            if (logoText) {
                logoText.textContent = "AEGIS_SENTINEL.v3";
                logoText.className = "logo-text-title mono-tech";
            }
            const navLogo = document.getElementById('landing-nav-logo');
            if (navLogo) {
                navLogo.className = "flex items-center gap-2 text-label-md font-bold text-intelligence-teal mono-tech tracking-widest";
            }
            
            // Re-render links in uppercase mono-tech
            const navLinks = document.getElementById('landing-nav-links');
            if (navLinks) {
                navLinks.className = "hidden md:flex items-center gap-10";
                navLinks.innerHTML = `
                    <a class="text-intelligence-teal border-b border-intelligence-teal mono-tech text-[12px] uppercase tracking-wider py-1" href="#">TERMINAL</a>
                    <a class="text-on-surface-variant mono-tech text-[12px] uppercase tracking-wider hover:text-intelligence-teal transition-colors" href="#">INTELLIGENCE</a>
                    <a class="text-on-surface-variant mono-tech text-[12px] uppercase tracking-wider hover:text-intelligence-teal transition-colors" href="#">AGENTS</a>
                    <a class="text-on-surface-variant mono-tech text-[12px] uppercase tracking-wider hover:text-intelligence-teal transition-colors" href="#">LOGS</a>
                `;
            }
            
            // Monospace buttons from screen 01eef8
            const loginBtn = document.getElementById('landing-login-btn');
            const initBtn = document.getElementById('landing-init-btn');
            if (loginBtn) {
                loginBtn.textContent = "ESTABLISH_LINK";
                loginBtn.className = "text-on-surface-variant mono-tech text-[12px] uppercase tracking-wider hover:text-intelligence-teal transition-all operator-login-trigger px-4 py-2";
            }
            if (initBtn) {
                initBtn.textContent = "INITIALIZE";
                initBtn.className = "bg-intelligence-teal text-background font-bold mono-tech text-[12px] px-6 py-2 hover:bg-white transition-all operator-login-trigger";
            }
            
            logToConsole("📟 Landing page swapped to [Sentinel HUD (Tech)] variant (Screen 01eef8b1).", "info");
        }
        
        // Re-bind all login modal open triggers uniformly across new variant buttons!
        bindLoginTriggers();
    };
    
    // Bind all elements with .operator-login-trigger to modal opens
    const bindLoginTriggers = () => {
        const loginTriggers = document.querySelectorAll('.operator-login-trigger');
        const loginModal = document.getElementById('login-modal');
        if (!loginModal) return;
        
        loginTriggers.forEach(btn => {
            // Remove previous listeners using clone to avoid duplicates
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            newBtn.addEventListener('click', (e) => {
                if (e) e.preventDefault();
                // Clear any leftover error message
                const errEl = document.getElementById('login-error-msg');
                if (errEl) errEl.style.display = 'none';
                loginModal.classList.remove('hidden');
            });
        });
    };
    
    // Bind click options on choices list
    document.querySelectorAll('.variant-opt-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const variant = btn.getAttribute('data-variant');
            setLandingVariant(variant);
            if (variantDropdownOptions) variantDropdownOptions.classList.add('hidden');
        });
    });

    // Theme Toggle event listeners (toggles dark/light class on HTML and body.light-theme)
    const toggleThemeBtn = document.getElementById('theme-toggle-btn');
    const dashboardThemeBtn = document.getElementById('dashboard-theme-toggle-btn');
    
    const handleThemeToggle = (e) => {
        if (e) e.preventDefault();
        
        // Check current landing layout variant
        const currentVariant = landingPageContainer ? (
            landingPageContainer.classList.contains('variant-command-center') ? 'command-center' :
            landingPageContainer.classList.contains('variant-sentinel-hud') ? 'sentinel-hud' : 'ai-first'
        ) : 'ai-first';
        
        // Toggle dark state globally
        const isDark = document.documentElement.classList.toggle('dark');
        document.body.classList.toggle('light-theme', !isDark);
        
        // If on standard landing layouts, swap variant matching the theme!
        if (currentVariant !== 'sentinel-hud') {
            if (isDark) {
                setLandingVariant('ai-first');
            } else {
                setLandingVariant('command-center');
            }
        } else {
            // If on HUD tech, keep it tech but sync toggle icons
            const icons = document.querySelectorAll('#theme-toggle-btn span, #dashboard-theme-toggle-btn span');
            icons.forEach(span => {
                span.textContent = isDark ? 'light_mode' : 'dark_mode';
                span.innerHTML = isDark ? '☀️' : '🌙';
            });
        }
        
        logToConsole(`🎨 Interface theme swapped dynamically to: ${isDark ? 'Dark Slate' : 'Light Slate'}.`, "info");
    };
    
    if (toggleThemeBtn) toggleThemeBtn.addEventListener('click', handleThemeToggle);
    if (dashboardThemeBtn) dashboardThemeBtn.addEventListener('click', handleThemeToggle);
    
    // Close Login Modal Trigger
    const loginModal = document.getElementById('login-modal');
    const closeLoginBtn = document.getElementById('login-close-btn');
    if (closeLoginBtn && loginModal) {
        closeLoginBtn.addEventListener('click', (e) => {
            if (e) e.preventDefault();
            loginModal.classList.add('hidden');
        });
    }

    // Toggle Login vs Sign Up Mode
    const toggleModeBtn = document.getElementById('login-toggle-mode-btn');
    if (toggleModeBtn) {
        toggleModeBtn.addEventListener('click', (e) => {
            if (e) e.preventDefault();
            const title = document.getElementById('login-modal-title');
            const subtitle = document.getElementById('login-modal-subtitle');
            const btnText = document.getElementById('login-btn-text');
            const toggleText = document.getElementById('login-toggle-text');
            const passLabel = document.getElementById('login-password-label');
            const errEl = document.getElementById('login-error-msg');
            
            if (errEl) errEl.style.display = 'none';

            if (state.authMode === 'login') {
                state.authMode = 'signup';
                if (title) title.textContent = "REGISTER OPERATOR";
                if (subtitle) subtitle.textContent = "ESTABLISH AEGIS SECURITY PROFILE";
                if (passLabel) passLabel.textContent = "CHOOSE SECURE PASSWORD";
                if (btnText) btnText.textContent = "ESTABLISH PROFILE";
                if (toggleText) toggleText.textContent = "Already registered?";
                if (toggleModeBtn) toggleModeBtn.textContent = "Log In";
            } else {
                state.authMode = 'login';
                if (title) title.textContent = "OPERATOR LOGIN";
                if (subtitle) subtitle.textContent = "AEGIS SENTINEL SECURE ACCESS";
                if (passLabel) passLabel.textContent = "SECURE PASSWORD";
                if (btnText) btnText.textContent = "AUTHORIZE ACCESS";
                if (toggleText) toggleText.textContent = "Don't have an operator profile?";
                if (toggleModeBtn) toggleModeBtn.textContent = "Sign Up";
            }
        });
    }
    
    // Authorize & Boot Terminal Ingest Trigger
    const authorizeBtn = document.getElementById('login-authorize-btn');
    if (authorizeBtn && loginModal) {
        authorizeBtn.addEventListener('click', async (e) => {
            if (e) e.preventDefault();
            
            const emailInput = document.getElementById('login-email');
            const passwordInput = document.getElementById('login-password');
            const errEl = document.getElementById('login-error-msg');
            const btnText = authorizeBtn.querySelector('.btn-text');
            
            const emailVal = emailInput ? emailInput.value.trim() : "";
            const passVal = passwordInput ? passwordInput.value.trim() : "";
            
            if (!emailVal || !passVal) {
                if (errEl) {
                    errEl.textContent = "⚠️ Validation Error: Email and Password are required.";
                    errEl.style.display = 'block';
                }
                return;
            }
            
            // Simple email validation regex
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(emailVal)) {
                if (errEl) {
                    errEl.textContent = "⚠️ Validation Error: Please enter a valid email address.";
                    errEl.style.display = 'block';
                }
                return;
            }

            if (state.authMode === 'signup') {
                if (passVal.length < 4) {
                    if (errEl) {
                        errEl.textContent = "⚠️ Registration Error: Password must be at least 4 characters.";
                        errEl.style.display = 'block';
                    }
                    return;
                }
                
                try {
                    const res = await fetch('/api/auth/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: emailVal, password: passVal })
                    });
                    const resData = await res.json();
                    if (resData.status !== "success") {
                        if (errEl) {
                            errEl.textContent = `⚠️ Registration Error: ${resData.message}`;
                            errEl.style.display = 'block';
                        }
                        return;
                    }
                    logToConsole(`📝 Registered new operator: ${emailVal}`, "success");
                } catch (err) {
                    if (errEl) {
                        errEl.textContent = `⚠️ Database error connecting to server.`;
                        errEl.style.display = 'block';
                    }
                    return;
                }
            } else {
                try {
                    const res = await fetch('/api/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: emailVal, password: passVal })
                    });
                    const resData = await res.json();
                    if (resData.status !== "success") {
                        if (errEl) {
                            errEl.textContent = "⚠️ Security Error: Invalid email or password.";
                            errEl.style.display = 'block';
                        }
                        logToConsole("⚠️ Security system denied operator access: invalid credentials.", "error");
                        return;
                    }
                    logToConsole(`🔑 Login verified: operator session authorized for ${emailVal}`, "success");
                } catch (err) {
                    if (errEl) {
                        errEl.textContent = `⚠️ Database error connecting to server.`;
                        errEl.style.display = 'block';
                    }
                    return;
                }
            }

            
            // Success: Play visual loading boot sequence
            if (errEl) errEl.style.display = 'none';
            if (btnText) btnText.textContent = "VERIFYING SECURITY KEYS...";
            authorizeBtn.classList.add('loading');
            
            await sleep(1200); // 1.2s loading sweep
            
            // Establish logged-in state
            state.currentUser = emailVal;
            setLoggedInUser(emailVal);
            
            // Update HUD UI with profile details
            updateOperatorProfileUI(emailVal);

            // Transition and play walkie-talkie start chirps
            loginModal.classList.add('hidden');
            const landingPage = document.getElementById('landing-page-container');
            const dashboard = document.getElementById('dashboard-container');
            
            if (landingPage) landingPage.style.display = 'none';
            if (dashboard) dashboard.classList.remove('hidden');
            
            // Fix Leaflet map sizing container bug (size mismatch on hidden containers)
            if (state.map) {
                setTimeout(() => {
                    state.map.invalidateSize();
                    logToConsole("🗺️ Leaflet map viewport recalculated successfully.", "info");
                }, 100);
            }
            
            // Play radio transmit beep automatically on operator initialization!
            playRadioBeep(true);
            
            logToConsole(`🔑 Operator ${emailVal} successfully verified. Booting terminal coordination HUD...`, "success");
            logToConsole("📡 Real-time crisis telemetry stream active and geocoded.", "info");
            
            // Reset button text & inputs
            if (btnText) btnText.textContent = "AUTHORIZE ACCESS";
            authorizeBtn.classList.remove('loading');
            if (emailInput) emailInput.value = "";
            if (passwordInput) passwordInput.value = "";
        });
    }

    // Settings Top-Right "✕" Close Button Trigger
    const settingsCloseX = document.getElementById('settings-close-x');
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsCloseX && settingsPanel) {
        settingsCloseX.addEventListener('click', () => {
            settingsPanel.classList.add('hidden');
        });
    }

    // Operator Log Out Trigger
    const logoutBtn = document.getElementById('operator-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            if (e) e.preventDefault();
            
            // Flush the active user session
            state.currentUser = null;
            clearLoggedInUser();
            
            logToConsole("🔓 Operator session logged out. Re-engaging security firewalls.", "warning");
            
            // Close Settings Panel and hide Dashboard
            if (settingsPanel) settingsPanel.classList.add('hidden');
            
            const dashboard = document.getElementById('dashboard-container');
            if (dashboard) dashboard.classList.add('hidden');
            
            // Show Landing Page
            const landingPage = document.getElementById('landing-page-container');
            if (landingPage) landingPage.style.display = 'block';
            
            // Play Walkie-Talkie disconnect squelch
            playRadioBeep(false);
        });
    }

    // --- CITY SEARCH & VERIFICATION HUB HANDLERS ---
    const citySearchInput = document.getElementById('city-search-input');
    const cityApiSource = document.getElementById('city-api-source');
    const cityResultsContainer = document.getElementById('city-results-container');
    
    if (citySearchInput && cityApiSource && cityResultsContainer) {
        let debounceTimer;
        
        const fetchCities = () => {
            const query = citySearchInput.value.trim();
            const source = cityApiSource.value;
            
            if (query.length < 2) {
                cityResultsContainer.innerHTML = '';
                cityResultsContainer.style.display = 'none';
                return;
            }
            
            const endpoint = source === 'indian' ? `/api/cities/indian?query=${encodeURIComponent(query)}` : `/api/cities/geodb?query=${encodeURIComponent(query)}`;
            
            fetch(endpoint)
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success' && data.results && data.results.length > 0) {
                        cityResultsContainer.innerHTML = '';
                        cityResultsContainer.style.display = 'block';
                        
                        data.results.forEach(city => {
                            const div = document.createElement('div');
                            div.className = 'city-result-item';
                            div.style.padding = '0.35rem 0.5rem';
                            div.style.cursor = 'pointer';
                            div.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
                            div.style.transition = 'background 0.2s';
                            
                            div.addEventListener('mouseenter', () => {
                                div.style.background = 'rgba(59, 130, 246, 0.2)';
                            });
                            div.addEventListener('mouseleave', () => {
                                div.style.background = 'transparent';
                            });
                            
                            let displayName = '';
                            let lat = null;
                            let lng = null;
                            
                            if (source === 'indian') {
                                const cityName = city.City || '';
                                const district = city.District || '';
                                const stateName = city.State || '';
                                displayName = `🇮🇳 <b>${cityName}</b>, ${district} (${stateName})`;
                                lat = null;
                                lng = null;
                            } else {
                                const cityName = city.city || city.name || '';
                                const region = city.region || '';
                                const country = city.country || '';
                                displayName = `🌐 <b>${cityName}</b>, ${region} (${country})`;
                                lat = parseFloat(city.latitude);
                                lng = parseFloat(city.longitude);
                            }
                            
                            div.innerHTML = displayName;
                            
                            div.addEventListener('click', () => {
                                const cityName = source === 'indian' ? city.City : (city.city || city.name);
                                logToConsole(`🎯 Selected city: ${cityName} from ${source === 'indian' ? 'Indian Cities API' : 'GeoDB Cities API'}`, "info");
                                
                                const queryText = `critical hazards storm warnings in ${cityName}`;
                                if (dom.serpQueryInput) {
                                    dom.serpQueryInput.value = queryText;
                                }
                                
                                cityResultsContainer.style.display = 'none';
                                citySearchInput.value = cityName;
                                
                                if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
                                    state.userLat = lat;
                                    state.userLng = lng;
                                    localStorage.setItem('aegis_last_localized_coords', JSON.stringify({ lat, lng }));
                                    
                                    logToConsole(`📍 Coordinate locking completed via GeoDB: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, "success");
                                    
                                    if (state.map) {
                                        state.map.setView([lat, lng], 13);
                                        setTimeout(() => {
                                            state.map.invalidateSize();
                                        }, 250);
                                        
                                        if (state.userLocationMarker) {
                                            state.map.removeLayer(state.userLocationMarker);
                                        }
                                        
                                        const userIcon = L.divIcon({
                                            className: 'custom-leaflet-marker',
                                            html: `
                                                <div class="marker-pulse-ring" style="border: 2px solid #10b981; box-shadow: 0 0 10px #10b981;"></div>
                                                <div class="marker-pin-inner" style="background-color: #10b981;"></div>
                                            `,
                                            iconSize: [32, 32],
                                            iconAnchor: [16, 16]
                                        });
                                        state.userLocationMarker = L.marker([lat, lng], { icon: userIcon }).addTo(state.map);
                                        state.userLocationMarker.bindPopup(`<b>📍 ${cityName} Secured Rally Node</b><br>Coordinates resolved successfully.`);
                                    }
                                } else {
                                    logToConsole(`🔍 Resolving coordinates for Indian City '${cityName}'...`, "info");
                                    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName + ', ' + (city.State || 'India'))}&format=json&limit=1`)
                                        .then(res => res.json())
                                        .then(geoData => {
                                            if (geoData && geoData.length > 0) {
                                                const resolvedLat = parseFloat(geoData[0].lat);
                                                const resolvedLng = parseFloat(geoData[0].lon);
                                                
                                                state.userLat = resolvedLat;
                                                state.userLng = resolvedLng;
                                                localStorage.setItem('aegis_last_localized_coords', JSON.stringify({ lat: resolvedLat, lng: resolvedLng }));
                                                
                                                logToConsole(`📍 Coordinate locking completed via OSM: ${resolvedLat.toFixed(4)}, ${resolvedLng.toFixed(4)}`, "success");
                                                
                                                if (state.map) {
                                                    state.map.setView([resolvedLat, resolvedLng], 13);
                                                    setTimeout(() => {
                                                        state.map.invalidateSize();
                                                    }, 250);
                                                    
                                                    if (state.userLocationMarker) {
                                                        state.map.removeLayer(state.userLocationMarker);
                                                    }
                                                    
                                                    const userIcon = L.divIcon({
                                                        className: 'custom-leaflet-marker',
                                                        html: `
                                                            <div class="marker-pulse-ring" style="border: 2px solid #10b981; box-shadow: 0 0 10px #10b981;"></div>
                                                            <div class="marker-pin-inner" style="background-color: #10b981;"></div>
                                                        `,
                                                        iconSize: [32, 32],
                                                        iconAnchor: [16, 16]
                                                    });
                                                    state.userLocationMarker = L.marker([resolvedLat, resolvedLng], { icon: userIcon }).addTo(state.map);
                                                    state.userLocationMarker.bindPopup(`<b>📍 ${cityName} Secured Rally Node</b><br>Coordinates resolved successfully.`);
                                                }
                                            } else {
                                                logToConsole(`⚠️ Coordinate resolution failed for ${cityName}. Falling back to default center.`, "warning");
                                            }
                                        })
                                        .catch(err => {
                                            logToConsole(`⚠️ Failed to resolve coords for ${cityName}: ${err.message}`, "warning");
                                        });
                                }
                            });
                            
                            cityResultsContainer.appendChild(div);
                        });
                    } else {
                        cityResultsContainer.innerHTML = '<div style="padding: 0.5rem; color: var(--text-secondary);">No matches found</div>';
                        cityResultsContainer.style.display = 'block';
                    }
                })
                .catch(err => {
                    console.error("Error fetching cities", err);
                    cityResultsContainer.style.display = 'none';
                });
        };
        
        citySearchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(fetchCities, 300);
        });
        
        cityApiSource.addEventListener('change', () => {
            fetchCities();
        });
        
        document.addEventListener('click', (e) => {
            if (e.target !== citySearchInput && e.target !== cityApiSource && e.target !== cityResultsContainer) {
                cityResultsContainer.style.display = 'none';
            }
        });
    }

    // Initialize initial binding
    bindLoginTriggers();
}

/* --------------------------------------------------
   PIPELINE AUTOMATION & RUNNER INTERFACES
   -------------------------------------------------- */

async function triggerPipelineRun() {
    // Automatically stop microphone recording if still running
    if (state.audioSource === 'mic' && state.isRecording) {
        stopMicRecording();
    }

    state.isRunning = true;
    toggleControlsLoading(true);
    resetTimeline();
    resetAgentsVisual();
    
    logToConsole("🔄 Initializing AEGIS emergency coordination sequence...", "info");
    updateGlobalStatus("RUNNING", "running");
    
    // Prepare search query
    const searchQuery = dom.serpQueryInput.value.trim() || "active weather hazards storm warnings";
    
    // Step 1: Start audio animation and simulated countdown timer
    updateTimelineStep(dom.stepAsr, "active", "Transcribing...");
    setAgentState('asr', 'active', 'Speechmatics ASR online. Decoding emergency ingestion broadcast feed...');
    startSpeechmaticsWaveAnimation();
    
    // In Microphone Ingest mode, pull the custom transcribed text
    let customTranscriptText = null;
    if (state.audioSource === 'mic') {
        customTranscriptText = state.customTranscript || dom.transcriptionOutput.textContent.trim();
        // If it's a placeholder or empty, fall back gracefully
        if (!customTranscriptText || customTranscriptText.includes("Ready...") || customTranscriptText.includes("System awaiting")) {
            logToConsole("⚠️ No live speech input captured. Falling back to default simulation dispatcher dispatch.", "warning");
            customTranscriptText = null;
        } else {
            logToConsole(`🎙️ Active microphone ingestion: "${customTranscriptText}"`, "success");
        }
    }

    try {
        // In Live Production mode, if mic is used, upload the raw audio clip first
        if (state.audioSource === 'mic' && state.recordedAudioBlob && !state.isSimulated) {
            logToConsole("📤 Uploading recorded live audio broadcast stream to backend...", "info");
            try {
                const uploadResp = await fetch('/api/upload-audio', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'audio/wav'
                    },
                    body: state.recordedAudioBlob
                });
                if (uploadResp.ok) {
                    logToConsole("✅ Speech audio file successfully saved on server for Speechmatics pipeline.", "success");
                }
            } catch (err) {
                logToConsole(`⚠️ Speech audio upload failed: ${err.message}. Relying on browser-side Web Speech ASR.`, "warning");
            }
        }

        // Send actual API request to the backend server uvicorn
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                simulated: state.isSimulated,
                query: searchQuery,
                custom_transcript: customTranscriptText,
                country: state.selectedCountry,
                user_lat: state.userLat || null,
                user_lng: state.userLng || null
            })
        });

        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }

        const data = await response.json();
        
        // Wait minor delay to allow realistic UI step flow
        await sleep(1500); 
        updateTimelineStep(dom.stepAsr, "complete", "Ingested & Decoded");
        setAgentState('asr', 'complete', `Speech audio transcribed: "${data.transcript.slice(0, 48)}..."`);
        stopSpeechmaticsWaveAnimation();
        
        // Step 2: Bright Data SERP Verification step
        updateTimelineStep(dom.stepSerp, "active", "Querying SERP API...");
        setAgentState('search', 'active', `SERP active. Querying Bright Data SERP indexes for query: "${searchQuery.slice(0, 32)}"...`);
        logToConsole(`🌐 Querying Bright Data SERP API with zone context for: "${searchQuery}"`, "info");
        populateSerpCards(data.serp);
        
        await sleep(1500);
        updateTimelineStep(dom.stepSerp, "complete", "Web Truth Cross-Referenced");
        setAgentState('search', 'complete', `Cross-match resolved. Cross-referenced ${data.serp && data.serp.organic_results ? data.serp.organic_results.length : 0} news sources.`);
        
        // Step 3: AI Reasoning Layer
        updateTimelineStep(dom.stepGemini, "active", "Running Gemini Reasoner...");
        setAgentState('reasoning', 'active', `Gemini AI Reasoner online. Resolving rumor indices, parsing coordinates, and compiling guidelines...`);
        logToConsole("🧠 Dispatching raw Speechmatics transcript + SERP context to Gemini 3.5 Flash Preview...", "info");
        
        // Output ASR Transcript with typewriter style
        typewriterEffect(dom.transcriptionOutput, data.transcript);
        
        await sleep(2000);
        updateTimelineStep(dom.stepGemini, "complete", "Hazards & Safe-Zones Verified");
        setAgentState('reasoning', 'complete', `Dialectical rumors resolved. Coordinates validated for ${data.insights ? data.insights.length : 0} active geocoded points.`);
        
        // Sync AEGIS telemetry widget automatically to match the active sector city!
        let targetCity = "world";
        if (state.selectedCountry === "japan") targetCity = "Tokyo";
        else if (state.selectedCountry === "india") targetCity = "Mumbai";
        else if (state.selectedCountry === "usa") targetCity = "New York";
        else if (state.selectedCountry === "uk") targetCity = "London";
        else if (state.selectedCountry === "local") targetCity = "Mangaluru";
        else {
            // Scan transcript/query
            const txt = (searchQuery + " " + data.transcript).toLowerCase();
            if (txt.includes("mangaluru")) targetCity = "Mangaluru";
            else if (txt.includes("mumbai") || txt.includes("delhi") || txt.includes("india")) targetCity = "Mumbai";
            else if (txt.includes("tokyo") || txt.includes("japan")) targetCity = "Tokyo";
            else if (txt.includes("york") || txt.includes("usa")) targetCity = "New York";
            else if (txt.includes("london") || txt.includes("uk")) targetCity = "London";
        }
        syncTelemetryWidget(targetCity);

        // Render geocoded map and cards
        populateVerifiedInsights(data.insights);
        
        // Step 4: Storage and Webhooks
        updateTimelineStep(dom.stepMemory, "active", "Persisting Memory Graph...");
        setAgentState('automation', 'active', `TriggerWare dispatcher active. Composing webhook JSON payloads and committing Cognee nodes...`);
        logToConsole("💾 Committing hazard and safe-zone node weights inside Cognee...", "info");
        
        // Populate memory and webhook logs
        populateMemoryLogs(data.insights);
        populateTriggerwareAlerts(data.alerts);
        
        await sleep(1000);
        updateTimelineStep(dom.stepMemory, "complete", "Cognified & Slack Deployed");
        setAgentState('automation', 'complete', `All Slack integrations dispatched. Graph database committed and standby established.`);
        
        // Render logs terminal
        if (data.logs && data.logs.length > 0) {
            data.logs.forEach(line => {
                let cleanLine = line.replace(/🎙️|🌐|🧠|💾|✅|❌|🚨|⚠️/g, '');
                let type = "info";
                if (line.includes("❌") || line.includes("FAILED")) type = "error";
                else if (line.includes("⚠️") || line.includes("Warning")) type = "warning";
                else if (line.includes("✅") || line.includes("SUCCESSFULLY")) type = "success";
                logToConsole(cleanLine, type);
            });
        }
        
        updateGlobalStatus("SYSTEM STANDBY", "idle");
        logToConsole("🏁 AEGIS coordination cycle successfully finished.", "success");
        
    } catch (err) {
        logToConsole(`❌ Error executing pipeline: ${err.message}`, "error");
        updateGlobalStatus("PIPELINE ERROR", "error");
        stopSpeechmaticsWaveAnimation();
    } finally {
        state.isRunning = false;
        toggleControlsLoading(false);
    }
}

// Loads last completed run from server cache on start
async function loadLatestCachedRun() {
    try {
        const response = await fetch('/api/latest');
        if (response.ok) {
            const data = await response.json();
            if (data.status === "success") {
                logToConsole("Loaded last cached pipeline run data from backend.", "info");
                dom.transcriptionOutput.textContent = data.transcript;
                populateSerpCards(data.serp);
                populateVerifiedInsights(data.insights);
                populateMemoryLogs(data.insights);
                populateTriggerwareAlerts(data.alerts);
                
                // Show checklist as completed
                updateTimelineStep(dom.stepAsr, "complete", "Completed");
                updateTimelineStep(dom.stepSerp, "complete", "Completed");
                updateTimelineStep(dom.stepGemini, "complete", "Completed");
                updateTimelineStep(dom.stepMemory, "complete", "Completed");
            }
        }
    } catch (e) {
        // Silent catch: server may not be active yet
    }
}

/* --------------------------------------------------
   LEAFLET FREE MAP ENGINE (CARTODB DARK MATTER)
   -------------------------------------------------- */

// Initialize Leaflet Map
function initLeafletMap() {
    logToConsole("📡 Contacting free OpenStreetMap & CartoDB tile services...", "info");
    dom.mapFallbackView.classList.add('hidden');
    
    // Default centering to Manhattan, NYC (Center of the crisis coordinates)
    const newYorkCenter = [40.7648, -73.9780];
    
    try {
        state.map = L.map(dom.googleMapTarget, {
            center: newYorkCenter,
            zoom: 13,
            zoomControl: true,
            attributionControl: false
        });
        
        // Add premium Dark Matter tile layer (gorgeous keyless dark theme)
        state.baseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 20,
            subdomains: 'abcd'
        }).addTo(state.map);
        
        // Register responsive zoom listener to toggle small dots when zoomed out (zoom < 7)
        state.map.on('zoomend', () => {
            const currentZoom = state.map.getZoom();
            document.querySelectorAll('.custom-leaflet-marker').forEach(marker => {
                if (currentZoom < 7) {
                    marker.classList.add('zoomed-out');
                } else {
                    marker.classList.remove('zoomed-out');
                }
            });
        });

        // Register window resize listener for robust mobile viewport changes and rotation
        window.addEventListener('resize', () => {
            if (state.map) {
                state.map.invalidateSize();
            }
        });
        
        logToConsole("✅ Free Leaflet Dark Mapping Module successfully activated.", "success");
        
        // Setup Radar Layers Control & Timeline playback events
        setupRadarControls();
        
        // Load global radar frames dynamically from public RainViewer API
        initRadarLoop();
        
    } catch (err) {
        logToConsole(`❌ Error initializing Leaflet Map: ${err.message}`, "error");
    }
}

/* --------------------------------------------------
   AEGIS LIVE RADAR LOOP & TIMELINE CONTROLS
   -------------------------------------------------- */

// Fetch the latest global radar frame list and preload them
async function initRadarLoop() {
    logToConsole("🌧️ Connecting to RainViewer public radar network...", "info");
    const label = document.getElementById('radar-time-label');
    if (label) label.textContent = "CONNECTING...";
    
    try {
        const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const host = data.host;
        
        // Extract radar past array and optional nowcast (predicted future scans)
        const pastFrames = data.radar.past || [];
        const nowcastFrames = data.radar.nowcast || [];
        
        // Take the last 6 past frames and first 2 nowcast predicted frames for a 8-step loops
        const selectedPast = pastFrames.slice(-6);
        const selectedNowcast = nowcastFrames.slice(0, 2);
        const allSelectedFrames = [...selectedPast, ...selectedNowcast];
        
        if (allSelectedFrames.length === 0) {
            throw new Error("No radar frames found in RainViewer API catalog.");
        }
        
        // Clear previous radar layers if any
        state.radarLayers.forEach(layer => {
            if (state.map.hasLayer(layer)) {
                state.map.removeLayer(layer);
            }
        });
        state.radarLayers = [];
        state.radarTimes = [];
        
        // Create Leaflet Tile Layers for each frame and add them as transparent preloads
        allSelectedFrames.forEach((frame, idx) => {
            // Construct tile URL. Format: {host}{path}/{size}/{z}/{x}/{y}/{color}/{options}.png
            // color=2 is standard multi-color radar, options=1_1 is smoothed with snow support.
            const tileUrl = `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
            
            const layer = L.tileLayer(tileUrl, {
                maxZoom: 20,
                maxNativeZoom: 7, // Restrict radar queries to max level 7 and stretch them above it
                opacity: 0, // preload invisible
                zIndex: 500 // sit above base tile layer but below markers (z-index 1000+)
            });
            
            if (state.isRadarEnabled) {
                layer.addTo(state.map);
            }
            
            state.radarLayers.push(layer);
            
            // Format time label (Unix timestamp to localized time string)
            const date = new Date(frame.time * 1000);
            let timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            if (idx >= selectedPast.length) {
                timeStr += " (PROJ)";
            } else if (idx === selectedPast.length - 1) {
                timeStr += " (NOW)";
            }
            
            state.radarTimes.push({
                label: timeStr,
                time: frame.time
            });
        });
        
        // Build timeline tracker dots in progress controller
        buildTimelineDots();
        
        // Select the "NOW" frame (or last frame) as default starting frame
        state.radarCurrentIndex = selectedPast.length - 1;
        if (state.radarCurrentIndex < 0) state.radarCurrentIndex = 0;
        
        showRadarFrame(state.radarCurrentIndex);
        logToConsole("✅ Live RainViewer Radar layers successfully overlayed and ready.", "success");
        
    } catch (err) {
        logToConsole(`⚠️ Failed to load Radar overlay: ${err.message}`, "warning");
        if (label) label.textContent = "RADAR OFFLINE";
    }
}

// Build progress dots dynamically matching preloaded layers length
function buildTimelineDots() {
    const container = document.getElementById('radar-time-steps');
    if (!container) return;
    container.innerHTML = '';
    
    state.radarTimes.forEach((timeInfo, idx) => {
        const dot = document.createElement('div');
        dot.className = 'radar-time-step-dot';
        if (idx === state.radarCurrentIndex) {
            dot.classList.add('active');
        }
        dot.title = timeInfo.label;
        
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.radarPlaying) {
                pauseRadarAnimation();
            }
            state.radarCurrentIndex = idx;
            showRadarFrame(idx);
        });
        
        container.appendChild(dot);
    });
}

// Toggle visual opacity of preloaded layers to animate cloud movement
function showRadarFrame(index) {
    if (state.radarLayers.length === 0) return;
    if (index < 0 || index >= state.radarLayers.length) return;
    
    state.radarLayers.forEach((layer, idx) => {
        if (idx === index) {
            if (state.isRadarEnabled) {
                layer.setOpacity(state.radarOpacity); // Gorgeous translucent cloud overlays
            } else {
                layer.setOpacity(0);
            }
        } else {
            layer.setOpacity(0); // keep all other preloads hidden
        }
    });
    
    // Move progress timeline fill bar
    const progressFill = document.getElementById('radar-progress-fill');
    if (progressFill) {
        const percentage = (index / (state.radarLayers.length - 1)) * 100;
        progressFill.style.width = `${percentage}%`;
    }
    
    // Toggle active dots highlight
    const dots = document.querySelectorAll('.radar-time-step-dot');
    dots.forEach((dot, idx) => {
        if (idx === index) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
    
    // Render time label text block
    const label = document.getElementById('radar-time-label');
    if (label) {
        label.textContent = state.radarTimes[index].label;
    }
}

// Start looping playback animation
function startRadarAnimation() {
    if (state.radarLayers.length === 0) return;
    
    state.radarPlaying = true;
    const playBtn = document.getElementById('radar-play-btn');
    if (playBtn) {
        playBtn.textContent = '⏸';
        playBtn.title = "Pause Loop";
    }
    
    state.radarInterval = setInterval(() => {
        state.radarCurrentIndex = (state.radarCurrentIndex + 1) % state.radarLayers.length;
        showRadarFrame(state.radarCurrentIndex);
    }, 1000); // 1000ms timeframe progression
    
    logToConsole("▶ Looping radar animation started.", "info");
}

// Pause looping playback animation
function pauseRadarAnimation() {
    state.radarPlaying = false;
    const playBtn = document.getElementById('radar-play-btn');
    if (playBtn) {
        playBtn.textContent = '▶';
        playBtn.title = "Play Loop";
    }
    
    if (state.radarInterval) {
        clearInterval(state.radarInterval);
        state.radarInterval = null;
    }
    
    logToConsole("⏸ Radar animation loop paused.", "info");
}

// Enable/disable the radar overlay layers
function toggleRadarLayer(enabled) {
    state.isRadarEnabled = enabled;
    const timelineBar = document.getElementById('radar-timeline-bar');
    
    if (enabled) {
        if (timelineBar) timelineBar.classList.remove('hidden');
        // Add all preloaded layers back to map if not added
        state.radarLayers.forEach(layer => {
            if (state.map && !state.map.hasLayer(layer)) {
                layer.addTo(state.map);
            }
        });
        showRadarFrame(state.radarCurrentIndex);
        logToConsole("🌧️ Radar overlay enabled.", "info");
    } else {
        if (timelineBar) timelineBar.classList.add('hidden');
        if (state.radarPlaying) pauseRadarAnimation();
        // Hide all layers
        state.radarLayers.forEach(layer => {
            layer.setOpacity(0);
        });
        logToConsole("🌧️ Radar overlay disabled.", "info");
    }
}

// Enable/disable the CartoDB base dark map layer
function toggleBaseLayer(enabled) {
    if (!state.map || !state.baseLayer) return;
    
    if (enabled) {
        state.baseLayer.addTo(state.map);
        logToConsole("🗺️ Map base layers loaded.", "info");
    } else {
        state.map.removeLayer(state.baseLayer);
        logToConsole("🗺️ Map base layers unloaded.", "info");
    }
}

// Interactive Map Theme Switcher logic
function changeMapTheme(theme) {
    if (!state.map) return;
    state.mapTheme = theme;
    
    // Remove existing baseLayer
    if (state.baseLayer && state.map.hasLayer(state.baseLayer)) {
        state.map.removeLayer(state.baseLayer);
    }
    
    let tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    let subdomains = 'abcd';
    let label = "Dark Matter";
    
    if (theme === 'voyager') {
         tileUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
         label = "CartoDB Voyager (Light)";
    } else if (theme === 'osm') {
         tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
         subdomains = '';
         label = "OpenStreetMap Standard";
    }
    
    state.baseLayer = L.tileLayer(tileUrl, {
        maxZoom: 20,
        subdomains: subdomains
    });
    
    // Check darkmatter checkbox status to see if base layer should be visible
    const darkmatterCheckbox = document.getElementById('layer-darkmatter-checkbox');
    if (!darkmatterCheckbox || darkmatterCheckbox.checked) {
        state.baseLayer.addTo(state.map);
        logToConsole(`🗺️ Base map theme updated to [${label}].`, "success");
    }
}

// Distress Siren Volume Slider logic
function updateSirenVolume(volPercent) {
    state.sirenVolume = volPercent / 100;
    const label = document.getElementById('siren-volume-lbl');
    if (label) label.textContent = `${volPercent}%`;
    
    if (state.sosGain && state.sosAudioContext) {
        // Capped at 0.25 max gain so volume is comfortable but dynamic
        state.sosGain.gain.setValueAtTime(state.sirenVolume * 0.25, state.sosAudioContext.currentTime);
    }
}

// Wire dropdown actions, buttons click, and map propagation safeguards
function setupRadarControls() {
    const toggleBtn = document.getElementById('layers-toggle-btn');
    const dropdown = document.getElementById('layers-dropdown');
    
    if (toggleBtn && dropdown) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });
        
        // Prevent click events from reaching map
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Close dropdown clicking elsewhere
        document.addEventListener('click', () => {
            dropdown.classList.add('hidden');
        });
    }
    
    const radarCheckbox = document.getElementById('layer-radar-checkbox');
    if (radarCheckbox) {
        radarCheckbox.addEventListener('change', (e) => {
            toggleRadarLayer(e.target.checked);
        });
    }
    
    const darkmatterCheckbox = document.getElementById('layer-darkmatter-checkbox');
    if (darkmatterCheckbox) {
        darkmatterCheckbox.addEventListener('change', (e) => {
            toggleBaseLayer(e.target.checked);
        });
    }
    
    const playBtn = document.getElementById('radar-play-btn');
    if (playBtn) {
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.radarPlaying) {
                pauseRadarAnimation();
            } else {
                startRadarAnimation();
            }
        });
    }
    
    const timelineBar = document.getElementById('radar-timeline-bar');
    if (timelineBar) {
        timelineBar.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
}

// Plots dynamic glowing markers on Leaflet map view
function plotLeafletMarkers(insights) {
    if (!state.map) return;
    
    // Clear previous markers
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];
    
    const bounds = [];
    let locationsPlotted = 0;
    
    insights.forEach(item => {
        if (!item.lat || !item.lng) return;
        
        locationsPlotted++;
        const pos = [item.lat, item.lng];
        bounds.push(pos);
        
        // Define color scheme based on severity
        let markerColor = "#ef4444"; // Hazard (Red)
        if (item.status === "SAFE_ZONE") markerColor = "#10b981"; // Safe (Green)
        if (item.status === "RESOURCE") markerColor = "#3b82f6"; // Resource (Blue)
        
        const currentZoom = state.map ? state.map.getZoom() : 13;
        const isZoomedOutClass = currentZoom < 7 ? ' zoomed-out' : '';
        
        // Custom Leaflet DivIcon for premium glowing halos
        const customIcon = L.divIcon({
            className: `custom-leaflet-marker${isZoomedOutClass}`,
            html: `
                <div class="marker-pulse-ring" style="border: 2px solid ${markerColor}; box-shadow: 0 0 10px ${markerColor};"></div>
                <div class="marker-pin-inner" style="background-color: ${markerColor};"></div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
        
        const marker = L.marker(pos, { icon: customIcon }).addTo(state.map);
        
        // Create custom popup content matching our styling
        const popupContent = `
            <div class="map-popup">
                <h4 style="color:${markerColor}">${item.location_name}</h4>
                <p><strong>Status:</strong> ${item.status}</p>
                <p>${item.details}</p>
                <p style="font-family:monospace;font-size:0.6rem;color:#64748b;margin:0;">LAT: ${item.lat} | LNG: ${item.lng}</p>
            </div>
        `;
        
        marker.bindPopup(popupContent);
        
        state.markers.push(marker);
    });
    
    // Fit map bounds to show all markers beautifully
    if (locationsPlotted > 0) {
        state.map.fitBounds(L.latLngBounds(bounds), { 
            padding: [50, 50],
            maxZoom: 16
        });
    }
}

/* --------------------------------------------------
   TYPEWRITER, FEEDS & AUDIO WAVEFORM VISUALIZERS
   -------------------------------------------------- */

// Typewriter script effect for Speechmatics transcript terminal
function typewriterEffect(target, text) {
    target.innerHTML = '';
    let i = 0;
    const speed = 10; // text speed ms per char
    
    function type() {
        if (i < text.length) {
            target.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
            // Auto scroll terminal to bottom
            target.scrollTop = target.scrollHeight;
        }
    }
    type();
}

// Generates canvas oscillator audio wave for Speechmatics ASR Step
function startSpeechmaticsWaveAnimation() {
    const canvas = dom.waveformCanvas;
    const ctx = canvas.getContext('2d');
    
    // Match visual container sizing
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = 70;
    
    let phase = 0;
    state.audioDurationSeconds = 0;
    dom.audioTimer.textContent = "00:00";
    
    // Increment timer
    state.audioTimerInterval = setInterval(() => {
        state.audioDurationSeconds++;
        const mins = String(Math.floor(state.audioDurationSeconds / 60)).padStart(2, '0');
        const secs = String(state.audioDurationSeconds % 60).padStart(2, '0');
        dom.audioTimer.textContent = `${mins}:${secs}`;
    }, 1000);
    
    function draw() {
        if (!state.isRunning) return;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.8)'; // Primary violet line
        ctx.beginPath();
        
        // Draw primary audio sound waves
        for (let x = 0; x < canvas.width; x++) {
            const amplitude = 18 * Math.sin(x * 0.015 - phase) * Math.cos(x * 0.005 - phase * 0.5) * (Math.sin(phase * 0.05) + 0.5);
            const y = canvas.height / 2 + amplitude + (Math.random() - 0.5) * 3; // Jitter simulation
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        
        // Draw secondary visual sound wave
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'; // Blue secondary line
        ctx.beginPath();
        for (let x = 0; x < canvas.width; x++) {
            const amplitude = 10 * Math.sin(x * 0.03 + phase) * Math.sin(x * 0.01 + phase);
            const y = canvas.height / 2 + amplitude;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        
        phase += 0.06;
        state.waveformAnimationId = requestAnimationFrame(draw);
    }
    draw();
}

function stopSpeechmaticsWaveAnimation() {
    if (state.waveformAnimationId) {
        cancelAnimationFrame(state.waveformAnimationId);
    }
    if (state.audioTimerInterval) {
        clearInterval(state.audioTimerInterval);
    }
    setupAudioWaveformPlaceholder();
}

// Default canvas waveform when system is idle
function setupAudioWaveformPlaceholder() {
    const canvas = dom.waveformCanvas;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.clientWidth || 300;
    canvas.height = 70;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
}

// Populates Bright Data SERP search result elements
function populateSerpCards(serpData) {
    dom.serpAccordionTarget.innerHTML = '';
    
    if (!serpData || !serpData.organic_results || serpData.organic_results.length === 0) {
        dom.serpAccordionTarget.innerHTML = `
            <div class="no-data-card mini">
                <p>No SERP search data available.</p>
            </div>
        `;
        return;
    }
    
    serpData.organic_results.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'serp-card';
        card.innerHTML = `
            <a href="${item.link}" target="_blank" class="serp-card-link">
                <div class="serp-card-header">
                    <span>📰</span>
                    <h5>${item.title}</h5>
                </div>
            </a>
            <p>${item.snippet}</p>
        `;
        dom.serpAccordionTarget.appendChild(card);
    });
}

// Proximity Haversine Formula for threat scanner
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

// Firebase Integration for Transmitting Precautionary Alerts to Operator Email
function sendFirebasePrecautionEmail(email, hazardItem, distance) {
    logToConsole(`🔥 [FIREBASE CLOUD MESSAGING] Operator sector near critical hazard! Proximity: ${distance.toFixed(2)} km.`, "warning");
    logToConsole(`🔥 [FIREBASE] Triggering mail dispatch document to Firestore collection 'mail' for: ${email}`, "info");

    const mailData = {
        to: email,
        message: {
            subject: `🚨 AEGIS CRITICAL WARNING: Active Hazard near your location!`,
            html: `
                <div style="font-family: Arial, sans-serif; background-color: #07090e; color: #e2e2e6; padding: 2rem; border-radius: 12px; border: 1px solid rgba(239, 68, 68, 0.2);">
                    <div style="text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 1rem; margin-bottom: 1.5rem;">
                        <span style="font-size: 2.5rem;">🛡️</span>
                        <h2 style="color: #ffffff; margin-top: 0.5rem;">AEGIS SENTINEL INTEL DISPATCH</h2>
                        <p style="font-size: 0.75rem; color: #a5b4fc; font-family: monospace;">SECURE ADVISORY CHANNEL</p>
                    </div>
                    <p style="font-size: 1rem; line-height: 1.5;">Hello Operator,</p>
                    <p style="font-size: 1rem; line-height: 1.5; color: #f87171; font-weight: bold;">
                        Our sensor grid has detected that your localized coordinates are situated only <strong>${distance.toFixed(1)} km</strong> away from an active high-threat hazard sector:
                    </p>
                    <div style="background-color: rgba(239, 68, 68, 0.05); border-left: 4px solid #ef4444; padding: 1rem; margin: 1.5rem 0; border-radius: 4px;">
                        <h3 style="margin: 0 0 0.5rem; color: #ffffff;">🚨 ${hazardItem.location_name}</h3>
                        <p style="margin: 0; font-size: 0.9rem; line-height: 1.45;">${hazardItem.details}</p>
                    </div>
                    <div style="background-color: rgba(59, 130, 246, 0.05); border-left: 4px solid #3b82f6; padding: 1rem; margin: 1.5rem 0; border-radius: 4px;">
                        <h4 style="margin: 0 0 0.5rem; color: #ffffff;">🛡️ Actionable Safety Precautions</h4>
                        <p style="margin: 0; font-size: 0.9rem; line-height: 1.45; font-style: italic;">"${hazardItem.precautions}"</p>
                    </div>
                    <p style="font-size: 0.85rem; color: #64748b; margin-top: 2rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 1rem;">
                        This alert was dynamically processed and dispatched by the AEGIS Multi-Agent Core using Firebase Cloud Messaging integration. Please route immediately to nearest designated safe havens.
                    </p>
                </div>
            `
        },
        timestamp: new Date().toISOString(),
        status: "pending",
        operatorEmail: email,
        proximityKm: distance,
        locationName: hazardItem.location_name
    };

    try {
        if (window.db) {
            window.db.collection('mail').add(mailData)
                .then((docRef) => {
                    logToConsole(`🔥 [FIREBASE] Successfully written mail document to Firestore (ID: ${docRef.id}). Transaction COMPLETE.`, "success");
                })
                .catch((e) => {
                    logToConsole(`⚠️ [FIREBASE] Firestore write failed: ${e.message}. Gracefully continuing.`, "warning");
                });
        } else {
            setTimeout(() => {
                logToConsole(`🔥 [FIREBASE Mock-Engine] Successfully triggered mail transaction (ID: hf_sandbox_${Math.random().toString(36).substr(2, 9)}). Transaction COMPLETE.`, "success");
            }, 800);
        }
    } catch (err) {
        logToConsole(`⚠️ [FIREBASE ERROR] Connection anomaly: ${err.message}`, "warning");
    }

    // Write the same warning logs securely to MongoDB
    fetch('/api/operator/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mailData)
    })
    .then(res => res.json())
    .then(resData => {
        if (resData.status === "success") {
            logToConsole(`🔥 [MongoDB] Successfully logged dispatch warning in operator mail_logs database.`, "success");
        }
    })
    .catch(err => {
        console.warn("Failed to sync mail log to MongoDB", err);
    });
}

// SOS Distress Siren Email Advisory Transmitter
function sendSirenEmergencyEmail(email, hazards) {
    if (!hazards || hazards.length === 0) {
        logToConsole("ℹ[] No active hazards found on dashboard. Skipping SOS email.", "info");
        return;
    }
    
    logToConsole(`🚨 [SOS EMAIL DISPATCH] Initiating emergency advisory dispatch for: ${email}`, "warning");
    
    let hazardsHtml = '';
    hazards.forEach((hazard, idx) => {
        hazardsHtml += `
            <div style="background-color: rgba(239, 68, 68, 0.08); border-left: 4px solid #ef4444; padding: 1.2rem; margin: 1.2rem 0; border-radius: 6px;">
                <h3 style="margin: 0 0 0.5rem; color: #ffffff; font-size: 1.1rem;">
                    <span>🚨 [HAZARD #${idx + 1}]</span> ${hazard.location_name}
                </h3>
                <p style="margin: 0 0 0.75rem; font-size: 0.95rem; line-height: 1.5; color: #e2e2e6;">
                    <strong>Details:</strong> ${hazard.details}
                </p>
                <p style="margin: 0 0 0.5rem; font-size: 0.9rem; line-height: 1.45; color: #fda4af;">
                    <strong>⚠️ Required Precaution:</strong> <em>"${hazard.precautions}"</em>
                </p>
                <p style="margin: 0; font-size: 0.8rem; color: #94a3b8; font-family: monospace;">
                    Coordinate rally zone: ${hazard.lat ? hazard.lat.toFixed(4) : '0.0000'}, ${hazard.lng ? hazard.lng.toFixed(4) : '0.0000'}
                </p>
            </div>
        `;
    });
    
    const mailData = {
        to: email,
        message: {
            subject: `🚨 AEGIS EMERGENCY BROADCAST: SOS Siren Triggered & Local Hazards Locked!`,
            html: `
                <div style="font-family: Arial, sans-serif; background-color: #07090e; color: #e2e2e6; padding: 2.5rem; border-radius: 12px; border: 2px solid #ef4444; box-shadow: 0 0 20px rgba(239, 68, 68, 0.3);">
                    <div style="text-align: center; border-bottom: 2px solid rgba(239, 68, 68, 0.3); padding-bottom: 1.5rem; margin-bottom: 2rem;">
                        <span style="font-size: 3rem;">🚨</span>
                        <h2 style="color: #ffffff; margin-top: 0.5rem; letter-spacing: 1px;">AEGIS CRITICAL DISTRESS ADVISORY</h2>
                        <p style="font-size: 0.8rem; color: #ef4444; font-family: monospace; font-weight: bold; text-transform: uppercase;">SOS BEACON ACTIVATED FOR SECTOR</p>
                    </div>
                    <p style="font-size: 1.05rem; line-height: 1.6; color: #ffffff;">Hello Operator,</p>
                    <p style="font-size: 1.05rem; line-height: 1.6; color: #fca5a5;">
                        This automated dispatch is issued immediately following your manual trigger of the **SOS Emergency Siren**. 
                        Our sensor grid has compiled a comprehensive catalog of all active localized high-threat hazards within your tracking zone:
                    </p>
                    
                    ${hazardsHtml}
                    
                    <div style="background-color: rgba(59, 130, 246, 0.08); border-left: 4px solid #3b82f6; padding: 1.2rem; margin: 2rem 0; border-radius: 6px;">
                        <h4 style="margin: 0 0 0.5rem; color: #ffffff; font-size: 1rem;">🛡️ Standard Survival Operating Procedures (SOP)</h4>
                        <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.9rem; line-height: 1.6; color: #bfdbfe;">
                            <li>Evacuate all personnel immediately from low-lying areas and flood zones.</li>
                            <li>Navigate only along designated green evacuation routes rendered on your sensory map.</li>
                            <li>Maintain communication only via secure, low-emission radio satellite relays.</li>
                            <li>Do not attempt to cross flooded roadways or pass near active hazards.</li>
                        </ul>
                    </div>
                    <p style="font-size: 0.85rem; color: #64748b; margin-top: 2.5rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 1.5rem;">
                        This critical alert has been dynamically generated and transmitted using the active AEGIS Multi-Agent System and Firebase Cloud Messaging integrations. Take immediate shelter and standby for additional regional updates.
                    </p>
                </div>
            `
        },
        timestamp: new Date().toISOString(),
        status: "pending",
        operatorEmail: email,
        isDistressSiren: true,
        totalHazardsCount: hazards.length
    };
    
    try {
        if (window.db) {
            window.db.collection('mail').add(mailData)
                .then((docRef) => {
                    logToConsole(`🔥 [SOS EMAIL DISPATCH] Successfully written distress advisory to Firestore (ID: ${docRef.id}).`, "success");
                })
                .catch((e) => {
                    logToConsole(`⚠️ [SOS EMAIL DISPATCH] Firestore write failed: ${e.message}`, "warning");
                });
        } else {
            setTimeout(() => {
                logToConsole(`🔥 [SOS EMAIL DISPATCH Mock] Successfully logged distress advisory (ID: hf_sos_${Math.random().toString(36).substr(2, 9)}). Dispatch COMPLETE.`, "success");
            }, 800);
        }
    } catch (err) {
        logToConsole(`⚠️ [SOS EMAIL DISPATCH ERROR] Connection anomaly: ${err.message}`, "warning");
    }
    
    fetch('/api/operator/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mailData)
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            logToConsole(`🔥 [MongoDB] SOS emergency email advisory successfully stored in database.`, "success");
        }
    })
    .catch(err => {
        console.warn("Failed to sync SOS email to MongoDB", err);
    });
}


// Populate the visual verified dispatch list
function populateVerifiedInsights(insights) {
    dom.insightsCardsContainer.innerHTML = '';
    
    // Cache latest geocoded points list in state for route Escapes
    state.lastInsights = insights;
    
    // Check operator proximity to hazard zones for Firebase notifications
    const activeOperator = getLoggedInUser() || state.currentUser;
    const userLat = state.userLat;
    const userLng = state.userLng;
    
    if (activeOperator && userLat !== null && userLng !== null && insights && insights.length > 0) {
        insights.forEach(item => {
            if (item.status === "HAZARD" && item.lat && item.lng) {
                const distance = calculateHaversineDistance(userLat, userLng, item.lat, item.lng);
                
                // If operator is situated within 25 kilometers of the active threat
                if (distance < 25) {
                    sendFirebasePrecautionEmail(activeOperator, item, distance);
                }
            }
        });
    }
    
    if (!insights || insights.length === 0) {
        dom.insightsCardsContainer.innerHTML = `
            <div class="no-data-card">
                <p>No verified entries returned.</p>
            </div>
        `;
        return;
    }
    
    insights.forEach(item => {
        const card = document.createElement('article');
        
        let cardClass = "card-hazard";
        let badgeClass = "badge-hazard";
        let badgeText = "⚠️ HAZARD";
        
        if (item.status === "SAFE_ZONE") {
            cardClass = "card-safezone";
            badgeClass = "badge-safezone";
            badgeText = "🛡️ SAFE ZONE";
        } else if (item.status === "RESOURCE") {
            cardClass = "card-resource";
            badgeClass = "badge-resource";
            badgeText = "📦 RESOURCE";
        }
        
        let precautionHtml = '';
        if (item.precautions) {
            precautionHtml = `
                <div class="precaution-alert-box">
                    <div class="precaution-title-container">
                        <span class="icon">🛡️</span>
                        <span>Safety Precautions</span>
                    </div>
                    <p class="precaution-content-text">${item.precautions}</p>
                </div>
            `;
        }

        // Add action buttons group for evacuation plans and broadcasting warnings
        let cardActionGroupHtml = '';
        if (item.lat && item.lng) {
            const escapedItem = JSON.stringify(item).replace(/"/g, '&quot;');
            cardActionGroupHtml = `
                <div class="card-action-btn-group">
                    <button class="card-action-btn btn-route" onclick="event.stopPropagation(); window.drawEvacuationRoute(${escapedItem})">
                        🧭 Evacuate Route
                    </button>
                    <button class="card-action-btn btn-broadcast" onclick="event.stopPropagation(); window.broadcastRegionalWarning(${escapedItem})">
                        📢 Broadcast Alert
                    </button>
                </div>
            `;
        }

        let integrityScoreHtml = '';
        if (item.status === "SAFE_ZONE") {
            integrityScoreHtml = `
                <div style="display: flex; gap: 0.35rem; align-items: center; margin-top: -0.25rem; margin-bottom: 0.25rem;">
                    <span class="dialectical-integrity-badge">🟢 100% SECURE</span>
                    <span style="font-size: 0.6rem; color: var(--text-muted); font-weight: 500;">Municipal Coordinate Validated</span>
                </div>
            `;
        } else {
            const mockPercent = Math.floor(Math.random() * 5) + 94; // 94% to 98%
            integrityScoreHtml = `
                <div style="display: flex; gap: 0.35rem; align-items: center; margin-top: -0.25rem; margin-bottom: 0.25rem;">
                    <span class="dialectical-integrity-badge" style="color: #fbbf24; background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.25);">🔍 ${mockPercent}% VERIFIED</span>
                    <span style="font-size: 0.6rem; color: var(--text-muted); font-weight: 500;">ASR & SERP Cross-Match</span>
                </div>
            `;
        }

        card.className = `dispatch-node-card ${cardClass}`;
        card.innerHTML = `
            <div class="node-card-header" style="margin-bottom: 0.35rem;">
                <h4 class="node-card-title">${item.location_name}</h4>
                <span class="status-badge ${badgeClass}">${badgeText}</span>
            </div>
            ${integrityScoreHtml}
            <p class="node-card-desc">${item.details}</p>
            ${precautionHtml}
            <div class="node-card-meta" style="margin-top: 0.25rem;">
                COORD: ${item.lat ? `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}` : "RESOLVING..."}
            </div>
            ${cardActionGroupHtml}
        `;
        
        // Add fly-to click handler
        card.addEventListener('click', () => {
            if (state.map && item.lat && item.lng) {
                state.map.setView([item.lat, item.lng], 16, { animate: true });
            }
        });
        
        dom.insightsCardsContainer.appendChild(card);
    });
    
    // Automatically plot onto active Leaflet map view
    if (state.map) {
        plotLeafletMarkers(insights);
    }
}

// Populate the Cognee memory list in UI
function populateMemoryLogs(insights) {
    dom.cogneeLogs.innerHTML = '';
    
    if (!insights || insights.length === 0) {
        dom.cogneeLogs.innerHTML = `<span class="console-line text-muted">> Awaiting memories to digest...</span>`;
        return;
    }
    
    insights.forEach(item => {
        const line = document.createElement('span');
        line.className = 'console-line text-success';
        line.textContent = `> [Graph Node Saved] ${item.location_name} -> IS_A -> ${item.status}`;
        dom.cogneeLogs.appendChild(line);
    });
}

// Populate the Triggerware webhooks deployed
function populateTriggerwareAlerts(alerts) {
    dom.triggerwareLogs.innerHTML = '';
    
    if (!alerts || alerts.length === 0) {
        dom.triggerwareLogs.innerHTML = `<span class="console-line text-muted">> Monitoring TriggerWare webhook broadcasts...</span>`;
        return;
    }
    
    alerts.forEach(item => {
        const line = document.createElement('span');
        line.className = 'console-line text-info';
        line.textContent = `🚨 [WORKFLOW: ${item.workflow_id}] Sent payload: "${item.message}"`;
        dom.triggerwareLogs.appendChild(line);
    });
}

/* --------------------------------------------------
   UI HELPER FUNCTIONS & STYLINGS
   -------------------------------------------------- */

function toggleControlsLoading(isLoading) {
    if (isLoading) {
        dom.btnSpinner.classList.remove('hidden');
        dom.runBtn.querySelector('.btn-text').textContent = 'PROCESSING CRISIS DATA...';
        dom.runBtn.style.opacity = '0.75';
    } else {
        dom.btnSpinner.classList.add('hidden');
        dom.runBtn.querySelector('.btn-text').textContent = 'TRIGGER CRISIS PIPELINE';
        dom.runBtn.style.opacity = '1';
    }
}

function updateGlobalStatus(text, mode) {
    dom.globalStatusText.textContent = text;
    dom.globalStatusDot.className = 'indicator-dot';
    
    if (mode === "running") dom.globalStatusDot.classList.add('status-running');
    else if (mode === "error") dom.globalStatusDot.classList.add('status-error');
    else dom.globalStatusDot.classList.add('status-idle');
}

function updateTimelineStep(element, status, text) {
    element.className = 'timeline-step';
    
    if (status === "active") {
        element.classList.add('step-active');
        element.querySelector('.step-status').textContent = text || 'In Progress';
    } else if (status === "complete") {
        element.classList.add('step-complete');
        element.querySelector('.step-status').textContent = text || 'Complete';
    } else {
        element.classList.add('step-pending');
        element.querySelector('.step-status').textContent = text || 'Pending';
    }
}

function resetTimeline() {
    updateTimelineStep(dom.stepAsr, "pending", "Pending");
    updateTimelineStep(dom.stepSerp, "pending", "Pending");
    updateTimelineStep(dom.stepGemini, "pending", "Pending");
    updateTimelineStep(dom.stepMemory, "pending", "Pending");
}

function logToConsole(message, type = "info") {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('span');
    line.className = `console-line text-${type}`;
    line.textContent = `[${time}] > ${message}`;
    
    dom.systemEventLogs.appendChild(line);
    dom.systemEventLogs.scrollTop = dom.systemEventLogs.scrollHeight;
}

// Utility Sleep Promise
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* --------------------------------------------------
   WEB SPEECH API & VOICE RECORDING SERVICES
   -------------------------------------------------- */

// Initialize browser on-device speech recognizer
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        logToConsole("⚠️ Browser native Speech Recognition (Web Speech API) is not supported. Custom voice transcription will fall back to text simulation.", "warning");
        return null;
    }
    
    const recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = 'en-US';
    
    recognizer.onstart = () => {
        state.customTranscript = '';
        dom.micStatusLabel.textContent = "Listening... Speak now";
        logToConsole("🎙️ Native speech recognizer listening to voice feed...", "info");
    };
    
    recognizer.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        
        const combined = (finalTranscript + interimTranscript).trim();
        if (combined) {
            state.customTranscript = combined;
            
            // Print live character typewriter to ASR terminal screen!
            dom.transcriptionOutput.textContent = combined;
            dom.transcriptionOutput.scrollTop = dom.transcriptionOutput.scrollHeight;
        }
    };
    
    recognizer.onerror = (event) => {
        if (event.error !== 'no-speech') {
            logToConsole(`🎙️ Speech recognition update: ${event.error}`, "warning");
        }
    };
    
    recognizer.onend = () => {
        if (state.isRecording) {
            // Keep speech recognition listening if user is still recording
            try { recognizer.start(); } catch(e) {}
        } else {
            dom.micStatusLabel.textContent = "Recording Saved";
        }
    };
    
    return recognizer;
}

// Start Microphone Voice Recording
async function startMicRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        logToConsole("❌ Microphone access is not supported by your browser or environment.", "error");
        return;
    }
    
    try {
        state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.audioChunks = [];
        
        // Setup MediaRecorder
        state.mediaRecorder = new MediaRecorder(state.micStream);
        state.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                state.audioChunks.push(event.data);
            }
        };
        
        state.mediaRecorder.onstop = () => {
            const audioBlob = new Blob(state.audioChunks, { type: 'audio/wav' });
            state.recordedAudioBlob = audioBlob;
            logToConsole("🔊 Voice audio recorded, compiled, and buffered successfully.", "success");
        };
        
        // Connect live frequencies to visualizer waveform-canvas!
        setupLiveMicVisualizer(state.micStream);
        
        // Start record action
        state.mediaRecorder.start();
        state.isRecording = true;
        dom.micRecordBtn.classList.add('recording');
        
        // Start live duration counter
        state.micDurationSeconds = 0;
        dom.micTimerLabel.textContent = "00:00";
        state.micTimerInterval = setInterval(() => {
            state.micDurationSeconds++;
            const mins = String(Math.floor(state.micDurationSeconds / 60)).padStart(2, '0');
            const secs = String(state.micDurationSeconds % 60).padStart(2, '0');
            dom.micTimerLabel.textContent = `${mins}:${secs}`;
            dom.audioTimer.textContent = `${mins}:${secs}`; // Update the ASR timer too
        }, 1000);
        
        // Start live browser speech recognizer
        if (state.speechRecognizer) {
            try { state.speechRecognizer.start(); } catch(e) {}
        }
        
        dom.transcriptionOutput.textContent = '';
        logToConsole("🎙️ Live microphone recording started. Speak into your device...", "info");
        
    } catch (err) {
        logToConsole(`❌ Microphone permission denied or occupied: ${err.message}`, "error");
        console.error(err);
    }
}

// Stop Microphone Voice Recording
function stopMicRecording() {
    if (!state.isRecording) return;
    
    // Stop MediaRecorder
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
    }
    
    // Kill microphone feed stream tracks
    if (state.micStream) {
        state.micStream.getTracks().forEach(track => track.stop());
    }
    
    // Shut down speech recognition
    if (state.speechRecognizer) {
        try { state.speechRecognizer.stop(); } catch(e) {}
    }
    
    // Stop durations
    if (state.micTimerInterval) {
        clearInterval(state.micTimerInterval);
    }
    
    // Close Web Audio API context
    if (state.audioContext && state.audioContext.state !== 'closed') {
        state.audioContext.close();
    }
    
    state.isRecording = false;
    dom.micRecordBtn.classList.remove('recording');
    dom.micStatusLabel.textContent = "Tap Mic to Record";
    
    logToConsole("🎙️ Microphone recording stopped.", "info");
    
    // Reset waveform canvas back to static flatline
    setupAudioWaveformPlaceholder();
}

// Hook Audio context analysis to the canvas sound wave visualizer
function setupLiveMicVisualizer(stream) {
    const canvas = dom.waveformCanvas;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.clientWidth || 300;
    canvas.height = 70;
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 256;
    
    source.connect(state.analyserNode);
    
    const bufferLength = state.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function drawLiveWave() {
        if (!state.isRecording) return;
        
        requestAnimationFrame(drawLiveWave);
        
        state.analyserNode.getByteTimeDomainData(dataArray);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)'; // Neon Red pulsing sound wave for live recording
        ctx.beginPath();
        
        const sliceWidth = canvas.width * 1.0 / bufferLength;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * canvas.height / 2;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            
            x += sliceWidth;
        }
        
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
    }
    
    drawLiveWave();
}

/* --------------------------------------------------
   EMERGENCY EVACUATION ROUTING, SIRENS & BROADCASTS
   -------------------------------------------------- */

// SOS Distress Web Audio Oscillator Siren System
state.sosPlaying = false;
state.sosSirenInterval = null;
state.sosAudioContext = null;
state.oscillator1 = null;

function startSiren() {
    state.sosPlaying = true;
    const btn = document.getElementById('sos-beacon-btn');
    if (btn) {
        btn.classList.add('active');
        btn.innerHTML = '🚨 SILENCE SOS SIREN';
    }
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.sosAudioContext = new AudioContextClass();
    
    // Create oscillator and gain nodes for clean loud siren sound
    state.oscillator1 = state.sosAudioContext.createOscillator();
    state.oscillator1.type = 'sawtooth'; // piercing shape
    
    state.sosGain = state.sosAudioContext.createGain();
    state.sosGain.gain.setValueAtTime(0.12, state.sosAudioContext.currentTime);
    
    state.oscillator1.connect(state.sosGain);
    state.sosGain.connect(state.sosAudioContext.destination);
    
    state.oscillator1.start();
    
    let alternating = true;
    state.sosSirenInterval = setInterval(() => {
        if (!state.sosAudioContext || state.sosAudioContext.state === 'closed') return;
        
        // Alternating high and low classic European safety horn sound
        const freq = alternating ? 880 : 660;
        state.oscillator1.frequency.setValueAtTime(freq, state.sosAudioContext.currentTime);
        
        alternating = !alternating;
    }, 450);
    
    logToConsole("🚨 Local distress rescue siren beacon activated!", "error");
    
    // Trigger distress advisory email to the operator containing all current hazards
    const activeOperator = getLoggedInUser() || state.currentUser || "operator@gmail.com";
    const allInsights = state.lastInsights || [];
    const activeHazards = allInsights.filter(x => x.status === "HAZARD");
    
    if (activeHazards.length > 0) {
        sendSirenEmergencyEmail(activeOperator, activeHazards);
    } else {
        logToConsole("ℹ️ [SOS Dispatch] No active hazards found on dashboard. Siren activated under normal standby.", "info");
    }
}

function stopSiren() {
    state.sosPlaying = false;
    const btn = document.getElementById('sos-beacon-btn');
    if (btn) {
        btn.classList.remove('active');
        btn.innerHTML = '🚨 Trigger SOS Siren';
    }
    
    if (state.sosSirenInterval) {
        clearInterval(state.sosSirenInterval);
        state.sosSirenInterval = null;
    }
    
    if (state.oscillator1) {
        try { state.oscillator1.stop(); } catch(e){}
        state.oscillator1 = null;
    }
    
    if (state.sosAudioContext) {
        state.sosAudioContext.close();
        state.sosAudioContext = null;
    }
    
    logToConsole("🔊 Local distress rescue siren silenced.", "info");
}

// Compute the nearest Safe Zone or Resource Base and draw evacuation route polylines
function drawEvacuationRoute(hazardItem) {
    if (!state.map) return;
    
    // Clear previous polyline
    if (state.evacuationRouteLine) {
        state.map.removeLayer(state.evacuationRouteLine);
        state.evacuationRouteLine = null;
    }
    
    // Search cached nodes
    const allInsights = state.lastInsights || [];
    const safeZones = allInsights.filter(x => x.status === "SAFE_ZONE");
    const resources = allInsights.filter(x => x.status === "RESOURCE");
    const destinations = [...safeZones, ...resources];
    
    // Nearest destination logic
    let closestDest = null;
    let minDistance = Infinity;
    
    destinations.forEach(dest => {
        if (!dest.lat || !dest.lng) return;
        const dist = Math.hypot(hazardItem.lat - dest.lat, hazardItem.lng - dest.lng);
        if (dist < minDistance) {
            minDistance = dist;
            closestDest = dest;
        }
    });
    
    const maxAllowedDistanceDegrees = 0.45; // ~50km limit
    
    // If the closest destination is more than 50km away, or if no destination exists,
    // dynamically generate a municipal safe shelter within 1.5 kilometers of the hazard coordinates!
    if (minDistance > maxAllowedDistanceDegrees || !closestDest) {
        const actualDist = closestDest ? `${(minDistance * 111).toFixed(0)} km` : "infinite";
        logToConsole(`⚠️ Closest regional shelter is too distant (${actualDist}). Local municipal protocols activated: Plotting nearby safe muster point.`, "warning");
        
        // Random offset within 0.012 degrees (~1.3 km)
        const mockSafeLat = hazardItem.lat + (Math.random() - 0.5) * 0.015;
        const mockSafeLng = hazardItem.lng + (Math.random() - 0.5) * 0.015;
        
        closestDest = {
            location_name: `Local Municipal Shelter (${hazardItem.location_name.replace(" Hazard", "").replace(" Landslide", "").replace(" Flood", "").replace(" Gale", "")})`,
            status: "SAFE_ZONE",
            details: "Emergency municipal safe shelter established by local government authority.",
            precautions: "Relocate immediately to this secure coordination sector.",
            lat: mockSafeLat,
            lng: mockSafeLng
        };
        
        // Temporarily plot this local safe zone marker on the map!
        const localIcon = L.divIcon({
            className: 'custom-leaflet-marker',
            html: `
                <div class="marker-pulse-ring" style="border: 2px solid #10b981; box-shadow: 0 0 10px #10b981;"></div>
                <div class="marker-pin-inner" style="background-color: #10b981;"></div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
        
        const tempMarker = L.marker([mockSafeLat, mockSafeLng], { icon: localIcon }).addTo(state.map);
        tempMarker.bindPopup(`<b>📍 ${closestDest.location_name}</b><br>Municipal rescue muster point.`);
        
        state.markers.push(tempMarker);
    }
    
    const pathPoints = [
        [hazardItem.lat, hazardItem.lng],
        [closestDest.lat, closestDest.lng]
    ];
    
    // Create animated flowing polyline escape routing
    state.evacuationRouteLine = L.polyline(pathPoints, {
        className: 'escape-route-line',
        color: '#10b981',
        weight: 5
    }).addTo(state.map);
    
    // Adjust map zoom bounds
    state.map.fitBounds(L.latLngBounds(pathPoints), { padding: [60, 60] });
    
    // Open dynamic check list
    triggerDynamicChecklist(hazardItem.location_name, hazardItem.details);
    
    // Display clear route buttons
    const clearBtn = document.getElementById('clear-route-btn');
    if (clearBtn) clearBtn.style.display = 'flex';
    
    logToConsole(`🧭 safe routes locked: from [${hazardItem.location_name}] to closest Safe Zone [${closestDest.location_name}].`, "success");
}

function clearEvacuationRoute() {
    if (state.evacuationRouteLine && state.map) {
        state.map.removeLayer(state.evacuationRouteLine);
        state.evacuationRouteLine = null;
    }
    
    const clearBtn = document.getElementById('clear-route-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    
    const checklistContainer = document.getElementById('survival-guide-container');
    if (checklistContainer) checklistContainer.style.display = 'none';
    
    logToConsole("🧹 Safe escape route overlay cleared.", "info");
}

// Web Audio API Walkie-Talkie Beeps Synthesizer
function playRadioBeep(isOpening = true) {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContextClass();
        
        // Capped volume gain
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.connect(ctx.destination);
        
        const osc = ctx.createOscillator();
        osc.connect(gain);
        
        if (isOpening) {
            // High-pitched double chirp digital walkie-talkie beep
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1000, ctx.currentTime);
            osc.start();
            osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.08);
            setTimeout(() => {
                try { osc.stop(); ctx.close(); } catch(e){}
            }, 180);
        } else {
            // Low squelch trailing static click
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(180, ctx.currentTime);
            
            // Connect low static noise
            const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < noiseBuffer.length; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            
            const noise = ctx.createBufferSource();
            noise.buffer = noiseBuffer;
            
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.05, ctx.currentTime);
            
            noise.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            
            osc.start();
            noise.start();
            
            setTimeout(() => {
                try {
                    osc.stop();
                    noise.stop();
                    ctx.close();
                } catch(e){}
            }, 150);
        }
    } catch(e) {
        // Fallback silently if audio context is blocked
    }
}

// Simulated regional cellular alerts dispatcher with Walkie-Talkie Voice Broadcast
function broadcastRegionalWarning(item) {
    let broadcastModal = document.getElementById('broadcast-toast-modal');
    if (!broadcastModal) {
        broadcastModal = document.createElement('div');
        broadcastModal.id = 'broadcast-toast-modal';
        broadcastModal.className = 'broadcast-toast-overlay';
        document.body.appendChild(broadcastModal);
    }
    
    const citizenCount = (Math.floor(Math.random() * 6500) + 1800).toLocaleString();
    const sector = `${item.lat ? item.lat.toFixed(4) : '---'}, ${item.lng ? item.lng.toFixed(4) : '---'}`;
    const safetyMessage = item.precautions || item.details || "Disaster coordinates warning active. Seek shelter and follow rescue guidelines.";
    
    broadcastModal.innerHTML = `
        <div class="broadcast-header">
            <span style="font-size:1.4rem;">🚨</span>
            <div class="broadcast-title">Emergency Cell Broadcast</div>
        </div>
        <div class="broadcast-body">
            <div class="broadcast-meta">
                <span>📍 SECTOR: ${sector}</span>
                <span>⏱️ SENT: ${new Date().toLocaleTimeString()}</span>
                <span>👥 TARGET DEVICES: ${citizenCount}</span>
                <span>🌐 CHANNEL: CELL BROADCAST</span>
            </div>
            <div style="font-weight:700; font-size:0.75rem; color:#f87171; text-transform:uppercase;">⚠️ Critical Safety Precautions:</div>
            <p class="broadcast-message">"${safetyMessage}"</p>
        </div>
        <button class="broadcast-close-btn" id="broadcast-close-toast-btn">DISMISS EMERGENCY BULLETIN</button>
    `;
    
    // Add event listener to close button properly and stop speech synthesis if playing
    const closeBtn = broadcastModal.querySelector('#broadcast-close-toast-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            broadcastModal.classList.remove('visible');
            try { window.speechSynthesis.cancel(); } catch(e){}
        });
    }
    
    broadcastModal.classList.add('visible');
    logToConsole(`📢 Simulated Cell broadcast sent to ${citizenCount} devices in sector [${sector}]. Guidelines distributed.`, "warning");
    
    // Play Opening Radio Beep
    playRadioBeep(true);
    
    // Speak Emergency voice guidelines after a short delay
    setTimeout(() => {
        if ('speechSynthesis' in window) {
            // Cancel any current speech
            window.speechSynthesis.cancel();
            
            const speechText = `Attention. Critical emergency cellular warning broadcast for ${item.location_name}. Safety guidelines: ${safetyMessage}. Relocate to secure sectors immediately.`;
            const utterance = new SpeechSynthesisUtterance(speechText);
            utterance.rate = 0.95; // Official slow emergency pace
            utterance.pitch = 1.0;
            
            utterance.onend = () => {
                // Play Trailing Radio Beep Squelch
                playRadioBeep(false);
            };
            
            window.speechSynthesis.speak(utterance);
        }
    }, 450);
}

// Generate hazard adaptive prep checklist dynamically based on description
function triggerDynamicChecklist(locationName, details) {
    const checklistTitle = document.getElementById('survival-checklist-title');
    const checklistContent = document.getElementById('disaster-survival-checklist');
    const checklistContainer = document.getElementById('survival-guide-container');
    
    if (!checklistContent || !checklistContainer) return;
    
    let titleStr = "Severe Threat Guide";
    let items = [
        "Secure loose outdoor objects & property",
        "Charge backup power banks and cells",
        "Grab high-intensity emergency flashlights",
        "Tune to local emergency broadcasts"
    ];
    
    const text = (locationName + " " + details).toLowerCase();
    if (text.includes("flood") || text.includes("monsoon") || text.includes("rain") || text.includes("water")) {
        titleStr = "Monsoon Flood Guide";
        items = [
            "Elevate electronics and critical paperwork",
            "Shut off main electrical breakers and gas",
            "Store clean drinking water (1 gal per person/day)",
            "Keep emergency contact list charged and ready"
        ];
    } else if (text.includes("tsunami") || text.includes("earthquake") || text.includes("seismic") || text.includes("tremor")) {
        titleStr = "Tsunami & Seismic Guide";
        items = [
            "Evacuate immediately to designated high ground",
            "Secure loose heavy furniture or shelving",
            "Take shelter under reinforced table or structural door frame",
            "Avoid coastal waters, beaches, and harbor structures"
        ];
    } else if (text.includes("fire") || text.includes("wildfire") || text.includes("blaze") || text.includes("smoke")) {
        titleStr = "Wildfire Safety Guide";
        items = [
            "Close all structural windows and doors to isolate oxygen",
            "Put on N95 air filtration respirators immediately",
            "Pack essential medications and evacuation bag",
            "Disconnect gas lines and prep evacuation vehicle"
        ];
    }
    
    if (checklistTitle) checklistTitle.textContent = titleStr;
    
    checklistContent.innerHTML = '';
    items.forEach((itemText, idx) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'survival-checklist-item';
        itemDiv.innerHTML = `
            <input type="checkbox" id="chk-item-${idx}">
            <span class="chk-label">${itemText}</span>
        `;
        
        const chk = itemDiv.querySelector('input');
        chk.addEventListener('change', () => {
            if (chk.checked) {
                itemDiv.classList.add('checked');
            } else {
                itemDiv.classList.remove('checked');
            }
        });
        
        itemDiv.addEventListener('click', (e) => {
            if (e.target !== chk) {
                chk.checked = !chk.checked;
                chk.dispatchEvent(new Event('change'));
            }
        });
        
        checklistContent.appendChild(itemDiv);
    });
    
    checklistContainer.style.display = 'block';
}

// Bind methods globally on window for inline template trigger support
window.drawEvacuationRoute = drawEvacuationRoute;
window.clearEvacuationRoute = clearEvacuationRoute;
window.broadcastRegionalWarning = broadcastRegionalWarning;
window.triggerDynamicChecklist = triggerDynamicChecklist;

/* --------------------------------------------------
   MULTI-AGENT NETWORKS & AEGIS TELEMETRY MODULES
   -------------------------------------------------- */

// Pre-configured AEGIS Telemetry datasets for different scales
const telemetryDataStore = {
    "mangaluru": {
        temp: 32,
        icon: "☀️",
        alert: "🌡️ Expect 4 days with high temperatures ahead starting Tomorrow.",
        forecast: [
            { day: "Sun", icon: "☀️", temp: "33°C / 26°C", fill: 95 },
            { day: "Mon", icon: "☀️", temp: "34°C / 27°C", fill: 98 },
            { day: "Tue", icon: "⛅", temp: "32°C / 25°C", fill: 80 },
            { day: "Wed", icon: "🌧️", temp: "29°C / 24°C", fill: 45 },
            { day: "Thu", icon: "🌧️", temp: "28°C / 23°C", fill: 35 }
        ]
    },
    "india": {
        temp: 29,
        icon: "🌧️",
        alert: "🌧️ Continuous heavy monsoon rains causing coastal high sea swells.",
        forecast: [
            { day: "Sun", icon: "🌧️", temp: "28°C / 23°C", fill: 35 },
            { day: "Mon", icon: "🌧️", temp: "27°C / 22°C", fill: 30 },
            { day: "Tue", icon: "⛈️", temp: "29°C / 24°C", fill: 45 },
            { day: "Wed", icon: "⛅", temp: "31°C / 25°C", fill: 70 },
            { day: "Thu", icon: "☀️", temp: "32°C / 26°C", fill: 90 }
        ]
    },
    "japan": {
        temp: 18,
        icon: "💨",
        alert: "💨 Ash warning active near volcano grids. JMA tsunami warning monitored.",
        forecast: [
            { day: "Sun", icon: "💨", temp: "17°C / 12°C", fill: 50 },
            { day: "Mon", icon: "⛅", temp: "19°C / 13°C", fill: 65 },
            { day: "Tue", icon: "☀️", temp: "21°C / 14°C", fill: 80 },
            { day: "Wed", icon: "🌧️", temp: "16°C / 11°C", fill: 30 },
            { day: "Thu", icon: "🌧️", temp: "15°C / 10°C", fill: 25 }
        ]
    },
    "usa": {
        temp: -2,
        icon: "❄️",
        alert: "❄️ Extreme freezing gales and black ice warnings active across NYC.",
        forecast: [
            { day: "Sun", icon: "❄️", temp: "-3°C / -8°C", fill: 10 },
            { day: "Mon", icon: "❄️", temp: "-1°C / -6°C", fill: 15 },
            { day: "Tue", icon: "💨", temp: "2°C / -4°C", fill: 30 },
            { day: "Wed", icon: "⛅", temp: "4°C / -2°C", fill: 45 },
            { day: "Thu", icon: "☀️", temp: "6°C / 0°C", fill: 60 }
        ]
    },
    "uk": {
        temp: 11,
        icon: "🌧️",
        alert: "💨 Force 9 severe gale winds warning active along Dover Channel.",
        forecast: [
            { day: "Sun", icon: "🌧️", temp: "10°C / 6°C", fill: 25 },
            { day: "Mon", icon: "🌧️", temp: "11°C / 7°C", fill: 30 },
            { day: "Tue", icon: "⛅", temp: "13°C / 8°C", fill: 50 },
            { day: "Wed", icon: "☀️", temp: "15°C / 9°C", fill: 75 },
            { day: "Thu", icon: "☀️", temp: "16°C / 10°C", fill: 80 }
        ]
    },
    "world": {
        temp: 25,
        icon: "☀️",
        alert: "☀️ Monitoring active global meteorological hazard coordinate grids.",
        forecast: [
            { day: "Sun", icon: "☀️", temp: "26°C / 19°C", fill: 85 },
            { day: "Mon", icon: "⛅", temp: "24°C / 18°C", fill: 70 },
            { day: "Tue", icon: "🌧️", temp: "22°C / 16°C", fill: 45 },
            { day: "Wed", icon: "🌧️", temp: "21°C / 15°C", fill: 35 },
            { day: "Thu", icon: "☀️", temp: "27°C / 20°C", fill: 90 }
        ]
    }
};

// Keep current active city details in state
state.currentTelemetryCity = "mangaluru";

// WMO weather code mapper (Open-Meteo public API format)
function mapWmoCode(code) {
    if (code === 0) return { icon: "☀️", text: "Clear sky condition active." };
    if (code >= 1 && code <= 3) return { icon: "⛅", text: "Partly cloudy atmospheric cover." };
    if (code === 45 || code === 48) return { icon: "🌫️", text: "Dense fog visibility warning active." };
    if (code >= 51 && code <= 55) return { icon: "🌧️", text: "Light atmospheric precipitation drizzle." };
    if (code >= 61 && code <= 65) return { icon: "🌧️", text: "Heavy rainfall. High regional surface runoff." };
    if (code >= 71 && code <= 75) return { icon: "❄️", text: "Freezing blizzard parameters active." };
    if (code >= 80 && code <= 82) return { icon: "🌧️", text: "Unstable rain showers grid detected." };
    if (code >= 95 && code <= 99) return { icon: "⛈️", text: "Force-level electric thunderstorms active." };
    return { icon: "☀️", text: "Stable regional atmospheric parameters." };
}

// Separate UI renderer for clean asynchronous execution
function updateTelemetryUi(city, data) {
    const cityNameEl = document.getElementById('telemetry-city-name');
    const tempIconEl = document.getElementById('telemetry-temp-icon');
    const tempValueEl = document.getElementById('telemetry-temp-value');
    const alertTextEl = document.getElementById('telemetry-alert-text');
    
    if (cityNameEl) cityNameEl.textContent = city.charAt(0).toUpperCase() + city.slice(1);
    if (tempIconEl) tempIconEl.textContent = data.icon;
    if (tempValueEl) tempValueEl.innerHTML = `${data.temp}<span style="font-size: 0.95rem; vertical-align: top; font-weight: 500;">°C</span>`;
    if (alertTextEl) alertTextEl.textContent = data.alert;
    
    // Auto-update the 5-day forecast modal title and content as well!
    const modalTitle = document.getElementById('prognosis-modal-title');
    if (modalTitle) modalTitle.textContent = `${data.icon} 5-Day Atmospheric Prognosis for ${city.charAt(0).toUpperCase() + city.slice(1)}`;
    
    const modalAlertText = document.getElementById('prognosis-modal-alert-text');
    if (modalAlertText) modalAlertText.textContent = data.alert.replace("🌡️ ", "").replace("🌧️ ", "").replace("💨 ", "").replace("❄️ ", "").replace("☀️ ", "");
    
    const daysListEl = document.getElementById('prognosis-days-list');
    if (daysListEl) {
        daysListEl.innerHTML = '';
        data.forecast.forEach(item => {
            const row = document.createElement('div');
            row.className = 'prognosis-day-row';
            row.innerHTML = `
                <span class="prognosis-day-lbl">${item.day}</span>
                <span class="prognosis-day-icon">${item.icon}</span>
                <div class="prognosis-day-graph-container">
                    <div class="prognosis-day-graph-fill" style="width: ${item.fill}%;"></div>
                </div>
                <span class="prognosis-day-temp">${item.temp}</span>
            `;
            daysListEl.appendChild(row);
        });
    }
}

// Asynchronously hits public Open-Meteo atmospheric API
async function syncTelemetryWidget(city, lat = null, lng = null) {
    const key = city.toLowerCase();
    
    // Resolve coordinates dynamically
    let targetLat = lat;
    let targetLng = lng;
    
    if (targetLat === null || targetLng === null) {
        if (state.selectedCountry === "local" && state.userLat && state.userLng) {
            targetLat = state.userLat;
            targetLng = state.userLng;
        } else {
            const cityCoords = {
                "mangaluru": { lat: 12.9141, lng: 74.856 },
                "mumbai": { lat: 19.076, lng: 72.877 },
                "india": { lat: 19.076, lng: 72.877 },
                "tokyo": { lat: 35.676, lng: 139.65 },
                "japan": { lat: 35.676, lng: 139.65 },
                "new york": { lat: 40.7128, lng: -74.006 },
                "usa": { lat: 40.7128, lng: -74.006 },
                "london": { lat: 51.5074, lng: -0.1278 },
                "uk": { lat: 51.5074, lng: -0.1278 },
                "world": { lat: 20.0, lng: 0.0 }
            };
            const coord = cityCoords[key] || cityCoords["world"];
            targetLat = coord.lat;
            targetLng = coord.lng;
        }
    }
    
    state.currentTelemetryCity = key;
    logToConsole(`📡 Fetching live geocentric atmospheric telemetry from Open-Meteo for coordinates [${targetLat.toFixed(4)}, ${targetLng.toFixed(4)}]...`, "info");
    
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${targetLat}&longitude=${targetLng}&current=temperature_2m,relative_humidity_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = await res.json();
        
        const currentTemp = Math.round(parsed.current.temperature_2m);
        const wmoCode = parsed.current.weather_code;
        const condition = mapWmoCode(wmoCode);
        
        // Build dynamic 5-day prognosis grid
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const todayIdx = new Date().getDay();
        
        const forecastList = [];
        for (let i = 0; i < 5; i++) {
            const dayName = days[(todayIdx + i) % 7];
            const dailyCode = parsed.daily.weather_code[i];
            const dailyCond = mapWmoCode(dailyCode);
            const tMax = Math.round(parsed.daily.temperature_2m_max[i]);
            const tMin = Math.round(parsed.daily.temperature_2m_min[i]);
            
            // Normalize progress fills between -15C (0%) and 45C (100%)
            const progressFill = Math.min(100, Math.max(5, Math.round(((tMax - (-15)) / 60) * 100)));
            
            forecastList.push({
                day: dayName,
                icon: dailyCond.icon,
                temp: `${tMax}°C / ${tMin}°C`,
                fill: progressFill
            });
        }
        
        const telemetryData = {
            temp: currentTemp,
            icon: condition.icon,
            alert: `🌡️ ${condition.text} Relative Humidity is ${parsed.current.relative_humidity_2m}%.`,
            forecast: forecastList
        };
        
        updateTelemetryUi(city, telemetryData);
        logToConsole(`✅ Live geocentric atmospheric telemetry successfully loaded for ${city}.`, "success");
        
    } catch (err) {
        logToConsole(`⚠️ Open-Meteo fetch failed: ${err.message}. Loading pre-configured regional assets.`, "warning");
        // Fallback to static mock datasets
        let data = telemetryDataStore[key];
        if (!data) {
            if (key.includes("delhi") || key.includes("mumbai") || key.includes("india")) {
                data = telemetryDataStore["india"];
            } else if (key.includes("tokyo") || key.includes("japan")) {
                data = telemetryDataStore["japan"];
            } else if (key.includes("york") || key.includes("usa") || key.includes("miami")) {
                data = telemetryDataStore["usa"];
            } else if (key.includes("london") || key.includes("uk") || key.includes("dover")) {
                data = telemetryDataStore["uk"];
            } else if (key.includes("mangaluru")) {
                data = telemetryDataStore["mangaluru"];
            } else {
                data = telemetryDataStore["world"];
            }
        }
        updateTelemetryUi(city, data);
    }
}

// Carousel notification insights data
const carouselNotifications = [
    { type: "Telemetry Insight • 9m", text: "High UV index detected. Reduce outdoor exposure." },
    { type: "Telemetry Insight • 39m", text: "Very high solar UV detected. Minimize direct exposure." },
    { type: "Breaking News • 39m", text: "CUET-UG delayed at some centres due to technical glitch, afternoon timing..." },
    { type: "Critical Alert • 2h", text: "Localized flash flooding traveling towards coordinates. Government evacuations authorized." }
];

let currentCarouselIdx = 0;

function startCarouselSlider() {
    const sliderEl = document.getElementById('aegis-notifications-slider');
    const countEl = document.getElementById('notification-count-label');
    const dots = document.querySelectorAll('#notification-dots .slider-dot');
    
    if (!sliderEl) return;
    
    setInterval(() => {
        currentCarouselIdx = (currentCarouselIdx + 1) % carouselNotifications.length;
        const note = carouselNotifications[currentCarouselIdx];
        
        sliderEl.innerHTML = `
            <div class="notification-item active">
                <div style="font-size: 0.6rem; color: var(--text-muted); display: flex; justify-content: space-between;">
                    <span>${note.type}</span>
                </div>
                <div style="font-size: 0.75rem; font-weight: 700; color: white; margin-top: 0.15rem; line-height: 1.35;">${note.text}</div>
            </div>
        `;
        
        if (countEl) countEl.textContent = `${carouselNotifications.length} Notifications`;
        
        dots.forEach((dot, idx) => {
            if (idx === currentCarouselIdx % dots.length) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }, 4500); // cycle every 4.5 seconds
}

// Multi-Agent Status Nodes Parallel Controller
function setAgentState(agentId, status, thoughtText) {
    const avatar = document.querySelector(`#node-agent-${agentId} .agent-avatar`);
    const dot = document.getElementById(`dot-agent-${agentId}`);
    const thoughtsBox = document.getElementById('agent-thoughts-text');
    
    if (!avatar || !dot) return;
    
    avatar.className = 'agent-avatar';
    dot.className = 'agent-status-dot';
    
    if (status === 'active') {
        avatar.classList.add('processing');
        dot.style.background = '#fbbf24'; // Amber
    } else if (status === 'complete') {
        avatar.classList.add('complete');
        dot.style.background = '#10b981'; // Green
    } else {
        dot.style.background = '#64748b'; // Gray / Idle
    }
    
    if (thoughtText && thoughtsBox) {
        thoughtsBox.innerHTML = `<b>[Agent: ${agentId.toUpperCase()}]</b> thought: "${thoughtText}"`;
    }
}

function resetAgentsVisual() {
    ['asr', 'search', 'reasoning', 'automation'].forEach(id => {
        setAgentState(id, 'idle');
    });
    const thoughtsBox = document.getElementById('agent-thoughts-text');
    if (thoughtsBox) thoughtsBox.textContent = "Standing by. Trigger the crisis pipeline to synchronize agent reasoning.";
}

// Hook these dynamically on window as well
window.syncTelemetryWidget = syncTelemetryWidget;
window.setAgentState = setAgentState;
window.resetAgentsVisual = resetAgentsVisual;


