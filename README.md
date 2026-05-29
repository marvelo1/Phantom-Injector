# 👻 Phantom Injector

**Frida Gadget injection for iOS 17/18 — run Frida on non-jailbroken devices.**

> Author: **marvelo** | For authorized security testing only.

---

## What It Does

Phantom Injector automates the process of embedding [Frida Gadget](https://frida.re/docs/gadget/) into an iOS `.ipa` file, enabling dynamic instrumentation on **non-jailbroken** devices. It handles everything:

- **Auto-detects** your host Frida version and downloads the matching Gadget
- **Injects** the Gadget `dylib` into the app's Mach-O binary (load command + rpath)
- **Writes** a listen-mode config for Objection/Frida TCP connections
- **Checks** architecture compatibility (arm64/arm64e) across LIEF versions
- **Repacks** a clean IPA ready for re-signing and installation
- **Defends** against Zip Slip attacks during extraction

---

## Requirements

| Dependency | Install |
|---|---|
| Python 3.8+ | [python.org](https://www.python.org/) |
| LIEF | `pip install lief` |
| Frida (optional, for auto-detect) | `pip install frida frida-tools` |
| pymobiledevice3 (for USB forwarding) | `pip install pymobiledevice3` |
| Objection (optional) | `pip install objection` |

### Quick Install

```bash
pip install lief frida frida-tools pymobiledevice3 objection
```

---

## Usage

### Basic

```bash
python phantom_injector.py app.ipa
```

This will produce `app-frida-listen.ipa` with Frida Gadget injected.

### All Options

```bash
python phantom_injector.py <path/to/app.ipa> \
    [--frida-version auto|17.6.2]       # Gadget version (default: auto-detect)
    [--prefer-latest]                     # Force latest from GitHub
    [--gadget-name FridaGadget.dylib]     # Custom dylib name
    [--port 27042]                        # Listen port (default: 27042)
    [--bundle-id com.example.app]         # Target specific app in IPA
    [--force]                             # Overwrite existing Gadget
    [--no-clean]                          # Keep _CodeSignature/SC_Info
    [--vibe cyberpunk|hacker|block|stealth|glitch|minimal]  # Banner style
    [--no-banner]                         # Suppress banner (CI mode)
    [--debug]                             # Verbose output
    [-o output.ipa]                       # Custom output path
```

### Examples

```bash
# Auto-detect Frida version, inject into DVIA
python phantom_injector.py DVIA-v2-swift.ipa

# Force specific Frida version
python phantom_injector.py app.ipa --frida-version 16.5.6

# Use latest Frida release, custom port, hacker banner
python phantom_injector.py app.ipa --prefer-latest --port 1337 --vibe hacker

# Force re-inject with debug output
python phantom_injector.py app.ipa --force --debug

# CI-friendly (no banner, no interaction)
python phantom_injector.py app.ipa --no-banner -o patched.ipa
```

---

## Full Workflow (Non-Jailbroken iOS)

### Step 1: Inject

```bash
python phantom_injector.py target.ipa
```

### Step 2: Resign & Install

Pick one method:

| Method | How |
|---|---|
| **Sideloadly** (easiest) | Drop IPA -> select Apple ID -> Start |
| **AltStore** | My Apps -> + -> choose IPA -> Install |
| **Xcode** | Re-sign Frameworks/*.dylib + .app with same Team ID |
| **CLI** | `zsign` / `isign` / `rcodesign` -> sign embedded -> sign app |

> **Important:** The Frida Gadget dylib must be signed with the **same Team ID** as the app. If it's unsigned, iOS will refuse to load it.

### Step 3: Launch the App

Open the app on your iPhone. It will **freeze at a white screen** — this is normal. The Gadget is waiting for a Frida connection.

For iOS 17/18, you can also launch paused via:
```bash
xcrun devicectl device process launch --device <UDID> --start-stopped <bundle-id>
```

### Step 4: USB Port Forward

```bash
pymobiledevice3 usbmux forward 27042 27042
```

Keep this terminal open.

### Step 5: Connect

```bash
# Frida CLI
frida -H 127.0.0.1:27042 Gadget

# Or with Objection
objection -N -P 27042 -n Gadget start
```

---

## SSL Pinning Bypass

An included `ssl_bypass.js` script provides universal SSL pinning bypass:

```bash
frida -H 127.0.0.1:27042 Gadget -l ssl_bypass.js
```

### What It Hooks

| Hook | Library / Framework |
|---|---|
| `SecTrustEvaluate` | Security.framework |
| `SecTrustEvaluateWithError` | Security.framework (iOS 12+) |
| `SecTrustEvaluateAsync` | Security.framework |
| `SSL_CTX_set_custom_verify` | BoringSSL (Chrome, gRPC) |
| `SSL_set_custom_verify` | BoringSSL per-connection |
| `didReceiveChallenge` | NSURLSession delegates |
| `AFSecurityPolicy` | AFNetworking |
| `TSKPinningValidator` | TrustKit |

### Setup with Burp Suite

1. **Burp Suite**: Proxy -> Options -> Bind to `0.0.0.0:8080`
2. **iPhone**: Settings -> Wi-Fi -> HTTP Proxy -> Manual -> Your PC IP, port `8080`
3. **Run**: `frida -H 127.0.0.1:27042 Gadget -l ssl_bypass.js`
4. **Browse**: Use the app — traffic appears in Burp with no SSL errors

---

## Banner Vibes

Phantom Injector ships with 6 banner styles:

```bash
--vibe cyberpunk   # Magenta/cyan gradient (default)
--vibe hacker      # Green terminal aesthetic
--vibe block       # Bold Unicode blocks
--vibe glitch      # Glitchy text
--vibe stealth     # Single line, minimal
--vibe minimal     # Clean one-liner
```

Preview (cyberpunk):
```
  ____  _                 _
 |  _ \| |__   __ _ _ __ | |_ ___  _ __ ___
 | |_) | '_ \ / _` | '_ \| __/ _ \| '_ ` _ \
 |  __/| | | | (_| | | | | || (_) | | | | | |
 |_|   |_| |_|\__,_|_| |_|\__\___/|_| |_| |_|
                    P H A N T O M   I N J E C T O R

Author: marvelo
```

---

## Troubleshooting

### App opens normally (doesn't freeze)
The Gadget dylib isn't loading. This means:
- The IPA wasn't **resigned properly** — iOS silently refuses unsigned dylibs
- Make sure all dylibs in `Frameworks/` are signed with the **same Team ID**

### "Connection closed" when connecting Frida
- The app must be **open and frozen** on the device
- Port forward must be **running** (`pymobiledevice3 usbmux forward 27042 27042`)
- Try restarting the app and reconnecting quickly

### "Failed to connect to remote endpoint" from pymobiledevice3
- The device isn't connected via USB, or the app isn't running
- Try: `pymobiledevice3 usbmux list` to verify device visibility

### Architecture mismatch error
- The Gadget dylib doesn't match the app's architecture
- Use `--prefer-latest` to get a universal (arm64 + arm64e) build

### Unicode/encoding errors on Windows
- Already fixed in this version — all output uses ASCII-safe characters

---

## Project Structure

```
ios/
├── phantom_injector.py   # Main injection tool
├── ssl_bypass.js         # Frida SSL pinning bypass script
├── README.md             # This file
└── *.ipa                 # Your target IPA files
```

---

## License

For authorized penetration testing and security research only.
Unauthorized use against applications you do not own or have permission to test is illegal.

---

**Made with 👻 by marvelo**
