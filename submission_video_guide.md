# 🎬 Lablab.ai Hackathon Submission Video Production Guide

This guide provides a professional production blueprint to replicate the fast-paced, high-engagement submission video style seen in elite hackathon demos (e.g., circular webcam overlay, dynamic zoom-ins, auto-captions, and jump-cut editing).

---

## 🛠️ The Software Stack

### 1. Recording (Choose One)
* **Tella.tv (Highly Recommended)**: The absolute best tool for developer demos. Automatically formats you in a premium circular bubble with custom background gradients, smooth camera-to-screen transitions, and auto-zoom-ins.
* **Loom**: Quick and easy circular camera bubble, but has fewer editing options.
* **OBS Studio (Free)**: Best for advanced control. Set up a screen source and a circular crop mask on your webcam source.

### 2. Editing & Captions (Choose One)
* **CapCut Desktop (Free & Fast)**: Best for adding the popular high-contrast, word-by-word auto-captions, background tracks, and simple zoom effects.
* **Screenflow or Camtasia**: Best for advanced screen recording controls, cursor smoothing, and high-fidelity canvas zooms.

---

## 📐 Video Structure (Capped at 120 Seconds)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   00:00-00:15   │  ►  │   00:15-00:35   │  ►  │   00:35-01:45   │  ►  │   01:45-02:00   │
│    THE HOOK     │     │   THE PROBLEM   │     │    LIVE DEMO    │     │    OUTRO/CTA    │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 1. The Hook (0 - 15 seconds)
* **Action**: Do NOT start with an introductory slide or a slow "Hi, my name is...". 
* **Visual**: Show the most exciting feature immediately (e.g. click "Broadcast Alert", hear the walkie-talkie beep, and let the voice broadcast play).
* **Script**: *"This is AEGIS Sentinel—a multi-agent emergency terminal that translates raw walkie-talkie dispatch audio into real-time local escape routing in seconds."*

### 2. The Problem & Architecture (15 - 35 seconds)
* **Action**: Cut to a clean side-by-side or simple architectural flowchart.
* **Visual**: Show the Multi-Agent operations HUD and the API ingestion stack.
* **Script**: *"Traditional crisis boards rely on static maps and clip life-saving precautions. AEGIS Sentinel uses a parallel multi-agent network combining Speechmatics, Bright Data SERP, and Gemini 3.5 to verify disasters, resolve rumors, and calculate safety routing."*

### 3. The Live Demo (35 - 105 seconds)
* **Action**: Fast-paced screen recording of the core workflows. Highlight three main components:
  * **📍 One-Click Localize**: Show clicking the button, geolocating on Leaflet, and Nominatim resolving the city.
  * **🧭 Proximity routing**: Click evacuate on a far-away hazard and show the system overriding cross-country paths to project a green municipal shelter 1.5 km away.
  * **🔊 Walkie-Talkie Speech warnings**: Show the cellular broadcast.
* **Editing Tip**: Apply **keyframe zoom-ins** on the map markers and terminal consoles when they are updating so the viewer isn't staring at a tiny static web layout.

### 4. The Outro & CTA (105 - 120 seconds)
* **Action**: Bring your camera bubble to the center of the screen or transition to a clean summary slide.
* **Script**: *"AEGIS Sentinel is fully Dockerized, zero-dependency, and ready for deployment on Hugging Face Spaces. Thanks for watching."*

---

## 🎨 Editing Secrets for that "Hackathon Winner" Look

### 1. Aggressive Jump-Cuts
* Delete **every single** breath, silence, "um", or typing pause.
* Split the audio track around silence and ripple-delete. The pacing should feel incredibly fast and seamless.

### 2. Zoom & Pan Transitions
* Whenever you say the name of a specific widget (e.g. "Multi-Agent HUD"), the video should immediately zoom in or transition to focus closely on that component.
* Use smooth ease-in/ease-out transitions rather than sudden cuts when zooming.

### 3. High-Contrast Auto-Captions
* Use CapCut’s **Auto Captions** tool to generate subtitles in seconds.
* Style the subtitles using a bold, clean font (e.g. *Montserrat*, *Cabinet Grotesk*, or *Impact*).
* Apply a yellow-on-white active word highlight or scale animation so they pop on screen word-by-word.

### 4. Background Audio
* Add a subtle, low-volume "tech/ambient/lo-fi" background beat. Keep the volume extremely low (around **-25dB to -30dB**) so it drives the pacing forward without overpowering your voice.
