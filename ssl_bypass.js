/*
 * iOS Universal SSL Pinning Bypass
 * Works with: NSURLSession, NSURLConnection, ATS, and common 3rd-party libs
 * Author: marvelo | For authorized security testing only
 *
 * Usage:
 *   frida -H 127.0.0.1:27042 Gadget -l ssl_bypass.js
 *   OR
 *   OR load via: frida -H 127.0.0.1:27042 Gadget -l ssl_bypass.js
 */

// Color helpers for console output
var Color = {
    Reset: "\x1b[0m",
    Green: "\x1b[32m",
    Yellow: "\x1b[33m",
    Cyan: "\x1b[36m",
    Red: "\x1b[31m"
};

function log(msg) {
    console.log(Color.Green + "[+] " + Color.Reset + msg);
}
function warn(msg) {
    console.log(Color.Yellow + "[!] " + Color.Reset + msg);
}

log("=== iOS SSL Pinning Bypass Loaded ===");

// ============================================================
// 1) NSURLSession: Hook the TLS challenge handler
//    This is the most common pinning mechanism in modern iOS apps
// ============================================================
try {
    var NSURLSessionConfiguration = ObjC.classes.NSURLSessionConfiguration;
    if (NSURLSessionConfiguration) {
        // Disable TLS validation at the session config level
        var orig_defaultSessionConfiguration = NSURLSessionConfiguration['+ defaultSessionConfiguration'];
        Interceptor.attach(orig_defaultSessionConfiguration.implementation, {
            onLeave: function(retval) {
                // We just log that a session config was created
                // The actual bypass happens in the delegate below
            }
        });
        log("Hooked NSURLSessionConfiguration");
    }
} catch(e) {
    warn("NSURLSessionConfiguration hook failed: " + e);
}

// ============================================================
// 2) SecTrustEvaluate — Low-level Security.framework bypass
//    Forces all certificate evaluations to return success
// ============================================================
try {
    var SecTrustEvaluate = Module.findExportByName("Security", "SecTrustEvaluate");
    if (SecTrustEvaluate) {
        Interceptor.attach(SecTrustEvaluate, {
            onLeave: function(retval) {
                // Write kSecTrustResultProceed (1) to the result pointer
                if (this.context !== undefined) {
                    retval.replace(0); // errSecSuccess
                }
            }
        });
        log("Hooked SecTrustEvaluate");
    }
} catch(e) {
    warn("SecTrustEvaluate hook failed: " + e);
}

// ============================================================
// 3) SecTrustEvaluateWithError (iOS 12+)
//    Returns true (trust succeeded) and clears error
// ============================================================
try {
    var SecTrustEvaluateWithError = Module.findExportByName("Security", "SecTrustEvaluateWithError");
    if (SecTrustEvaluateWithError) {
        Interceptor.attach(SecTrustEvaluateWithError, {
            onLeave: function(retval) {
                retval.replace(1); // true = trust succeeded
            }
        });
        log("Hooked SecTrustEvaluateWithError (iOS 12+)");
    }
} catch(e) {
    warn("SecTrustEvaluateWithError hook failed: " + e);
}

// ============================================================
// 4) SecTrustEvaluateAsync
// ============================================================
try {
    var SecTrustEvaluateAsync = Module.findExportByName("Security", "SecTrustEvaluateAsync");
    if (SecTrustEvaluateAsync) {
        Interceptor.attach(SecTrustEvaluateAsync, {
            onLeave: function(retval) {
                retval.replace(0); // errSecSuccess
            }
        });
        log("Hooked SecTrustEvaluateAsync");
    }
} catch(e) {
    warn("SecTrustEvaluateAsync hook failed: " + e);
}

// ============================================================
// 5) ssl_ctx_set_custom_verify (BoringSSL / libboringssl)
//    Used by apps using BoringSSL directly (e.g., Chrome, gRPC)
// ============================================================
try {
    var ssl_ctx_set_custom_verify = Module.findExportByName(null, "SSL_CTX_set_custom_verify");
    if (ssl_ctx_set_custom_verify) {
        Interceptor.attach(ssl_ctx_set_custom_verify, {
            onEnter: function(args) {
                // Replace callback with NULL (no custom verification)
                args[2] = ptr(0);
            }
        });
        log("Hooked SSL_CTX_set_custom_verify (BoringSSL)");
    }
} catch(e) {
    // Not all apps use BoringSSL
}

// ============================================================
// 6) SSL_set_custom_verify (BoringSSL per-connection)
// ============================================================
try {
    var ssl_set_custom_verify = Module.findExportByName(null, "SSL_set_custom_verify");
    if (ssl_set_custom_verify) {
        Interceptor.attach(ssl_set_custom_verify, {
            onEnter: function(args) {
                args[2] = ptr(0);
            }
        });
        log("Hooked SSL_set_custom_verify (BoringSSL)");
    }
} catch(e) {}

// ============================================================
// 7) SecTrustGetTrustResult — override trust result
// ============================================================
try {
    var SecTrustGetTrustResult = Module.findExportByName("Security", "SecTrustGetTrustResult");
    if (SecTrustGetTrustResult) {
        Interceptor.attach(SecTrustGetTrustResult, {
            onLeave: function(retval) {
                retval.replace(0);
            }
        });
        log("Hooked SecTrustGetTrustResult");
    }
} catch(e) {}

// ============================================================
// 8) NSURLSession delegate — didReceiveChallenge
//    Intercept the ObjC delegate method that handles auth challenges
// ============================================================
try {
    // Hook URLSession:didReceiveChallenge:completionHandler:
    var resolver = new ApiResolver('objc');
    var matches = resolver.enumerateMatches('-[* URLSession:didReceiveChallenge:completionHandler:]');
    
    if (matches.length > 0) {
        matches.forEach(function(match) {
            try {
                Interceptor.attach(match.address, {
                    onEnter: function(args) {
                        // args[0] = self, args[1] = _cmd, args[2] = session,
                        // args[3] = challenge, args[4] = completionHandler
                        var challenge = new ObjC.Object(args[3]);
                        var protectionSpace = challenge.protectionSpace();
                        var authMethod = protectionSpace.authenticationMethod().toString();
                        
                        if (authMethod === "NSURLAuthenticationMethodServerTrust") {
                            var serverTrust = protectionSpace.serverTrust();
                            var completionHandler = new ObjC.Block(ptr(args[4]));
                            
                            // Call completionHandler with UseCredential + serverTrust
                            // 0 = NSURLSessionAuthChallengeUseCredential
                            var credential = ObjC.classes.NSURLCredential.credentialForTrust_(serverTrust);
                            completionHandler.invoke(0, credential);
                            
                            // Replace the original implementation to not call again
                            this.shouldBypass = true;
                            log("Bypassed SSL challenge for: " + protectionSpace.host().toString());
                        }
                    },
                    onLeave: function(retval) {
                        // If we already handled it, prevent double-call
                    }
                });
            } catch(e) {}
        });
        log("Hooked " + matches.length + " didReceiveChallenge delegate(s)");
    }
} catch(e) {
    warn("didReceiveChallenge hook failed: " + e);
}

// ============================================================
// 9) AFNetworking / Alamofire SecurityPolicy bypass
// ============================================================
try {
    if (ObjC.classes.AFSecurityPolicy) {
        Interceptor.attach(ObjC.classes.AFSecurityPolicy['- setSSLPinningMode:'].implementation, {
            onEnter: function(args) {
                args[2] = ptr(0); // AFSSLPinningModeNone
            }
        });
        Interceptor.attach(ObjC.classes.AFSecurityPolicy['- setAllowInvalidCertificates:'].implementation, {
            onEnter: function(args) {
                args[2] = ptr(1); // YES
            }
        });
        log("Hooked AFNetworking AFSecurityPolicy");
    }
} catch(e) {}

// ============================================================
// 10) TrustKit bypass
// ============================================================
try {
    if (ObjC.classes.TSKPinningValidator) {
        Interceptor.attach(ObjC.classes.TSKPinningValidator['- evaluateTrust:forHostname:'].implementation, {
            onLeave: function(retval) {
                retval.replace(0); // TSKTrustDecisionShouldAllowConnection
            }
        });
        log("Hooked TrustKit TSKPinningValidator");
    }
} catch(e) {}

log("=== SSL Pinning Bypass Active ===");
log("Now configure your proxy (Burp/mitmproxy) and intercept traffic!");
