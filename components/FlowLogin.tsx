import React, { useState, useCallback, useEffect, useRef } from 'react';
import { saveUserPersonalAuthToken, saveUserRecaptchaToken, hasActiveTokenUltra, getMasterRecaptchaToken, getTokenUltraRegistration, getEmailFromPoolByCode } from '../services/userService';
import { type User } from '../types';
import { KeyIcon, CheckCircleIcon, XIcon, AlertTriangleIcon, InformationCircleIcon, EyeIcon, EyeOffIcon, SparklesIcon, ClipboardIcon } from './Icons';
import Spinner from './common/Spinner';
import { getTranslations } from '../services/translations';
import { runComprehensiveTokenTest, type TokenTestResult } from '../services/imagenV3Service';
import { testAntiCaptchaKey } from '../services/antiCaptchaService';

interface FlowLoginProps {
    currentUser?: User | null;
    onUserUpdate?: (user: User) => void;
}

const FlowLogin: React.FC<FlowLoginProps> = ({ currentUser, onUserUpdate }) => {
    const [flowToken, setFlowToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [testStatus, setTestStatus] = useState<'idle' | 'testing'>('idle');
    const [testResults, setTestResults] = useState<TokenTestResult[] | null>(null);
    const [tokenSaved, setTokenSaved] = useState(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const recaptchaSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isInitialMount = useRef(true);
    const T = getTranslations().settingsView;
    const T_Api = T.api;

    // Anti-Captcha Configuration State - Load from currentUser
    const [enableAntiCaptcha, setEnableAntiCaptcha] = useState(true); // Always enabled
    // Initialize immediately from currentUser if available
    const [antiCaptchaApiKey, setAntiCaptchaApiKey] = useState(() => {
        if (!currentUser) return '';
        
        // Check sessionStorage first for master token (Token Ultra users)
        const cachedUltraStatus = sessionStorage.getItem(`token_ultra_active_${currentUser.id}`);
        if (cachedUltraStatus === 'true') {
            const cachedMasterToken = sessionStorage.getItem('master_recaptcha_token');
            if (cachedMasterToken && cachedMasterToken.trim()) {
                return cachedMasterToken;
            }
        }
        
        // Fallback to user's own token
        return currentUser.recaptchaToken || '';
    });
    const [antiCaptchaProjectId, setAntiCaptchaProjectId] = useState(() => {
        return localStorage.getItem('antiCaptchaProjectId') || ''; // Keep projectId in localStorage for now
    });
    const [showAntiCaptchaKey, setShowAntiCaptchaKey] = useState(false);
    const [antiCaptchaTestStatus, setAntiCaptchaTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [antiCaptchaTestMessage, setAntiCaptchaTestMessage] = useState<string>('');
    const [recaptchaTokenSaved, setRecaptchaTokenSaved] = useState(false);
    const [isSavingRecaptcha, setIsSavingRecaptcha] = useState(false);
    const [tokenUltraRegistration, setTokenUltraRegistration] = useState<any>(null);
    const [emailDetails, setEmailDetails] = useState<{ email: string; password: string } | null>(null);
    const [showUltraPassword, setShowUltraPassword] = useState(false);
    const [copiedUltraEmail, setCopiedUltraEmail] = useState(false);
    const [copiedUltraPassword, setCopiedUltraPassword] = useState(false);
    
    // Initialize token from current user
    useEffect(() => {
        if (currentUser?.personalAuthToken) {
            setFlowToken(currentUser.personalAuthToken);
        }
        
        // Initialize recaptcha token - check for master token if user has active token ultra
        const loadRecaptchaToken = async () => {
            if (!currentUser) return;
            
            // Check sessionStorage first for cached token ultra status
            const cachedUltraStatus = sessionStorage.getItem(`token_ultra_active_${currentUser.id}`);
            const isActiveUltra = cachedUltraStatus === 'true';
            
            if (isActiveUltra) {
                // Token Ultra user - Use master recaptcha token from sessionStorage
                const cachedMasterToken = sessionStorage.getItem('master_recaptcha_token');
                if (cachedMasterToken && cachedMasterToken.trim()) {
                    setAntiCaptchaApiKey(cachedMasterToken);
                    return;
                }
                
                // Fallback: fetch if not cached
                const masterTokenResult = await getMasterRecaptchaToken();
                if (masterTokenResult.success && masterTokenResult.apiKey) {
                    setAntiCaptchaApiKey(masterTokenResult.apiKey);
                    return;
                }
            }
            
            // User biasa - Use their own recaptcha token
            // Always try to load user's token, regardless of cached status
            if (currentUser?.recaptchaToken) {
                setAntiCaptchaApiKey(currentUser.recaptchaToken);
            } else {
                // If token not in currentUser, try to fetch from database
                try {
                    const profile = await getUserProfile(currentUser.id);
                    if (profile?.recaptchaToken) {
                        setAntiCaptchaApiKey(profile.recaptchaToken);
                    }
                } catch (error) {
                    console.error('[FlowLogin] Failed to fetch user recaptcha token:', error);
                }
            }
        };
        
        loadRecaptchaToken();
        
        // Load Token Ultra registration and email details
        const loadTokenUltraDetails = async () => {
            if (!currentUser) return;
            
            const regResult = await getTokenUltraRegistration(currentUser.id);
            if (regResult.success && regResult.registration) {
                setTokenUltraRegistration(regResult.registration);
                
                // Load email details from pool if email_code exists
                if (regResult.registration.email_code) {
                    const emailResult = await getEmailFromPoolByCode(regResult.registration.email_code);
                    if (emailResult.success) {
                        setEmailDetails({
                            email: emailResult.email,
                            password: emailResult.password
                        });
                    }
                }
            }
        };
        
        loadTokenUltraDetails();
        
        // Mark initial mount as complete after first render
        if (isInitialMount.current) {
            isInitialMount.current = false;
        }
    }, [currentUser?.personalAuthToken, currentUser?.recaptchaToken, currentUser?.id]);

    // Auto-save Flow Token with debounce (2 seconds after user stops typing)
    useEffect(() => {
        // Skip auto-save on initial mount
        if (isInitialMount.current) {
            return;
        }

        // Don't save if user is not logged in
        if (!currentUser) {
            return;
        }

        // Don't save if token is empty or same as current user's token
        if (!flowToken.trim() || flowToken.trim() === currentUser?.personalAuthToken) {
            // Clear any existing timeout if token is empty or unchanged
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
            }
            return;
        }

        // Clear previous timeout
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Set debounce timer
        saveTimeoutRef.current = setTimeout(async () => {
            try {
                setIsSaving(true);
                setError(null);
                setSuccessMessage(null);
                
                const result = await saveUserPersonalAuthToken(currentUser.id, flowToken.trim());
                
                if (result.success) {
                    setTokenSaved(true);
                    setSuccessMessage('Flow token saved successfully!');
                    if (onUserUpdate) {
                        onUserUpdate(result.user);
                    }
                    // Clear saved indicator after 3 seconds
                    setTimeout(() => {
                        setTokenSaved(false);
                        setSuccessMessage(null);
                    }, 3000);
                } else {
                    // Handle specific error cases
                    const errorMessage = result.message || 'Failed to save token';
                    setError(errorMessage);
                    
                    // Clear error after 5 seconds
                    setTimeout(() => {
                        setError(null);
                    }, 5000);
                }
            } catch (err) {
                // Better error handling for network/API errors
                let errorMessage = 'An error occurred while saving token';
                
                if (err instanceof Error) {
                    errorMessage = err.message;
                    // Handle specific error types
                    if (err.message.includes('Load failed') || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                        errorMessage = 'Network error: Unable to connect to server. Please check your internet connection and try again.';
                    } else if (err.message.includes('TypeError')) {
                        errorMessage = 'Connection error: Please check your internet connection and try again.';
                    }
                } else if (typeof err === 'string') {
                    errorMessage = err;
                }
                
                setError(errorMessage);
                
                // Clear error after 5 seconds
                setTimeout(() => {
                    setError(null);
                }, 5000);
            } finally {
                setIsSaving(false);
            }
        }, 2000); // Wait 2 seconds after user stops typing

        // Cleanup
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
            }
        };
    }, [flowToken, currentUser, onUserUpdate]);

    // Auto-save Recaptcha Token (Anti-Captcha API Key) with debounce (2 seconds after user stops typing)
    useEffect(() => {
        // Skip auto-save on initial mount
        if (isInitialMount.current) {
            return;
        }

        // Don't save if user is not logged in
        if (!currentUser) {
            return;
        }

        // Check if token is unchanged
        const checkTokenUnchanged = async () => {
            if (!antiCaptchaApiKey.trim()) return true;
            
            // Check if user has active token ultra registration
            const hasActiveUltra = await hasActiveTokenUltra(currentUser.id);
            
            if (hasActiveUltra) {
                // Compare with master token for token ultra users
                const masterTokenResult = await getMasterRecaptchaToken();
                if (masterTokenResult.success && masterTokenResult.apiKey) {
                    return antiCaptchaApiKey.trim() === masterTokenResult.apiKey;
                }
            }
            
            // Fallback to compare with user's own token
            return antiCaptchaApiKey.trim() === currentUser?.recaptchaToken;
        };
        
        // Don't save if token is empty or unchanged
        checkTokenUnchanged().then(isUnchanged => {
            if (!antiCaptchaApiKey.trim() || isUnchanged) {
                // Clear any existing timeout if token is empty or unchanged
                if (recaptchaSaveTimeoutRef.current) {
                    clearTimeout(recaptchaSaveTimeoutRef.current);
                    recaptchaSaveTimeoutRef.current = null;
                }
                return;
            }
        });

        // Clear previous timeout
        if (recaptchaSaveTimeoutRef.current) {
            clearTimeout(recaptchaSaveTimeoutRef.current);
        }

        // Set debounce timer
        recaptchaSaveTimeoutRef.current = setTimeout(async () => {
            try {
                setIsSavingRecaptcha(true);
                setError(null);
                
                const result = await saveUserRecaptchaToken(currentUser.id, antiCaptchaApiKey.trim());
                
                if (result.success) {
                    setRecaptchaTokenSaved(true);
                    if (onUserUpdate) {
                        onUserUpdate(result.user);
                    }
                    // Clear saved indicator after 3 seconds
                    setTimeout(() => {
                        setRecaptchaTokenSaved(false);
                    }, 3000);
                } else {
                    // Handle specific error cases
                    const errorMessage = result.message || 'Failed to save recaptcha token';
                    setError(errorMessage);
                    
                    // Clear error after 5 seconds
                    setTimeout(() => {
                        setError(null);
                    }, 5000);
                }
            } catch (err) {
                // Better error handling for network/API errors
                let errorMessage = 'An error occurred while saving recaptcha token';
                
                if (err instanceof Error) {
                    errorMessage = err.message;
                    // Handle specific error types
                    if (err.message.includes('Load failed') || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                        errorMessage = 'Network error: Unable to connect to server. Please check your internet connection and try again.';
                    } else if (err.message.includes('TypeError')) {
                        errorMessage = 'Connection error: Please check your internet connection and try again.';
                    }
                } else if (typeof err === 'string') {
                    errorMessage = err;
                }
                
                setError(errorMessage);
                
                // Clear error after 5 seconds
                setTimeout(() => {
                    setError(null);
                }, 5000);
            } finally {
                setIsSavingRecaptcha(false);
            }
        }, 2000); // Wait 2 seconds after user stops typing

        // Cleanup
        return () => {
            if (recaptchaSaveTimeoutRef.current) {
                clearTimeout(recaptchaSaveTimeoutRef.current);
                recaptchaSaveTimeoutRef.current = null;
            }
        };
    }, [antiCaptchaApiKey, currentUser, onUserUpdate]);

    // Keep projectId in localStorage for now (optional field)
    useEffect(() => {
        localStorage.setItem('antiCaptchaProjectId', antiCaptchaProjectId);
    }, [antiCaptchaProjectId]);

    // Test Anti-Captcha API Key
    const handleTestAntiCaptcha = async () => {
        if (!antiCaptchaApiKey.trim()) {
            setAntiCaptchaTestStatus('error');
            setAntiCaptchaTestMessage('Please enter an API key');
            setTimeout(() => setAntiCaptchaTestStatus('idle'), 3000);
            return;
        }

        setAntiCaptchaTestStatus('testing');
        setAntiCaptchaTestMessage('Testing API key...');

        try {
            const result = await testAntiCaptchaKey(antiCaptchaApiKey.trim());
            if (result.valid) {
                setAntiCaptchaTestStatus('success');
                setAntiCaptchaTestMessage('✅ API key is valid!');
            } else {
                setAntiCaptchaTestStatus('error');
                setAntiCaptchaTestMessage(`❌ ${result.error || 'Invalid API key'}`);
            }
        } catch (error) {
            setAntiCaptchaTestStatus('error');
            setAntiCaptchaTestMessage(`❌ ${error instanceof Error ? error.message : 'Test failed'}`);
        }

        setTimeout(() => {
            setAntiCaptchaTestStatus('idle');
            setAntiCaptchaTestMessage('');
        }, 5000);
    };
    
    const handleSaveToken = async () => {
        if (!currentUser) {
            setError('Please login first');
            return;
        }

        if (!flowToken.trim()) {
            setError('Please enter a Flow token');
            return;
        }

        setIsSaving(true);
        setError(null);
        setSuccessMessage(null);
        setSaveStatus('idle');

        try {
            const result = await saveUserPersonalAuthToken(currentUser.id, flowToken.trim());
            
            if (result.success) {
                setSaveStatus('success');
                setSuccessMessage('Flow token saved successfully!');
                if (onUserUpdate) {
                    onUserUpdate(result.user);
                }
                // Clear success message after 3 seconds, but keep token in field
                setTimeout(() => {
                    setSaveStatus('idle');
                    setSuccessMessage(null);
                }, 3000);
            } else {
                setSaveStatus('error');
                const errorMessage = result.message || 'Failed to save token';
                setError(errorMessage);
                // Clear error after 5 seconds
                setTimeout(() => {
                    setError(null);
                }, 5000);
            }
        } catch (err) {
            setSaveStatus('error');
            const errorMessage = err instanceof Error ? err.message : 'An error occurred while saving token';
            setError(errorMessage);
            // Clear error after 5 seconds
            setTimeout(() => {
                setError(null);
            }, 5000);
        } finally {
            setIsSaving(false);
        }
    };

    const handleOpenFlow = () => {
        window.open('https://labs.google/fx/tools/flow', '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');
    };

    const handleGetToken = () => {
        window.open('https://labs.google/fx/api/auth/session', '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');
    };

    const handleTestToken = useCallback(async () => {
        const tokenToTest = flowToken.trim() || currentUser?.personalAuthToken;
        if (!tokenToTest) {
            setError('Please enter a token to test');
            return;
        }
        
        setTestStatus('testing');
        setTestResults(null);
        setError(null);
        
        try {
            const results = await runComprehensiveTokenTest(tokenToTest);
            setTestResults(results);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Test failed');
        } finally {
            setTestStatus('idle');
        }
    }, [flowToken, currentUser?.personalAuthToken]);

    if (!currentUser) {
        return (
            <div className="w-full max-w-2xl mx-auto">
                <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-lg p-6 md:p-8 border border-neutral-200 dark:border-neutral-800">
                    <div className="text-center py-8">
                        <AlertTriangleIcon className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-neutral-800 dark:text-neutral-200 mb-2">
                            Login Required
                        </h3>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400">
                            Please login to your account first to use Flow Login
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Left Panel: Flow Login */}
                <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-sm p-6 h-full overflow-y-auto">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                            <KeyIcon className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-neutral-800 dark:text-neutral-200">
                                Flow Login
                            </h2>
                            <p className="text-sm text-neutral-500 dark:text-neutral-400">
                                Login ke akun Flow Anda dan ambil token manual
                            </p>
                        </div>
                    </div>

                    <div className="mb-6">
                        <div className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border-[0.5px] border-blue-200 dark:border-blue-800">
                            <InformationCircleIcon className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                            <div className="text-[11px] sm:text-xs text-blue-800 dark:text-blue-200">
                                <p className="text-[11px] sm:text-xs font-semibold mb-2">Cara Mengambil Token dari Flow:</p>
                                <ol className="text-[11px] sm:text-xs space-y-1 list-decimal list-inside">
                                    <li>Klik tombol "Login Google Flow" untuk login ke akun Google Flow anda</li>
                                    <li>Selepas login, klik tombol "Get Token" untuk membuka halaman session API</li>
                                    <li>Copy token dari response JSON yang muncul</li>
                                    <li>Paste token tersebut di form di atas</li>
                                    <li>Token akan auto-save secara automatik</li>
                                </ol>
                            </div>
                        </div>
                    </div>

                {successMessage && (
                    <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                        <div className="flex items-center gap-2">
                            <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
                            <span className="font-semibold text-green-800 dark:text-green-200">{successMessage}</span>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <div className="flex items-center gap-2">
                            <XIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
                            <span className="font-semibold text-red-800 dark:text-red-200">{error}</span>
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    <div>
                        <label htmlFor="flow-token" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                            Personal Token (Flow Token) *
                        </label>
                        <div className="relative">
                            <input
                                id="flow-token"
                                type={showToken ? 'text' : 'password'}
                                value={flowToken}
                                onChange={(e) => {
                                    const newValue = e.target.value;
                                    setFlowToken(newValue);
                                    setTestResults(null);
                                    // Clear error when user starts typing again
                                    if (error) {
                                        setError(null);
                                    }
                                }}
                                onPaste={(e) => {
                                    // Clear error on paste
                                    if (error) {
                                        setError(null);
                                    }
                                }}
                                placeholder="Paste your Flow token here"
                                className="w-full px-4 py-3 pr-20 bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors font-mono text-sm"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center gap-2 pr-2">
                                {tokenSaved && flowToken.trim() && (
                                    <span className="text-xs text-green-600 dark:text-green-400 font-medium">Saved</span>
                                )}
                                {isSaving && (
                                    <Spinner />
                                )}
                                <button
                                    type="button"
                                    onClick={() => setShowToken(!showToken)}
                                    className="px-3 flex items-center text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                                >
                                    {showToken ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                            Token dari akun Flow Anda (labs.google/fx/tools/flow)
                            {flowToken.trim() && <span className="ml-2 text-green-600 dark:text-green-400">• Auto-saved</span>}
                        </p>
                        
                        {/* Google Ultra AI Account Credentials - Show if user has Token Ultra registration */}
                        {tokenUltraRegistration?.email_code && emailDetails && (
                            <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-3">
                                    Google Ultra AI Account Credentials
                                </h4>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">
                                            Email:
                                        </label>
                                        <div className="bg-white dark:bg-neutral-800 px-3 py-2 rounded border border-blue-200 dark:border-blue-700 flex items-center justify-between">
                                            <span className="text-sm font-mono text-blue-900 dark:text-blue-100">
                                                {emailDetails.email}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        await navigator.clipboard.writeText(emailDetails.email);
                                                        setCopiedUltraEmail(true);
                                                        setTimeout(() => setCopiedUltraEmail(false), 2000);
                                                    } catch (err) {
                                                        console.error('Failed to copy email:', err);
                                                    }
                                                }}
                                                className="ml-2 p-1.5 hover:bg-blue-100 dark:hover:bg-blue-800 rounded transition-colors"
                                                aria-label="Copy email"
                                                title="Copy email"
                                            >
                                                {copiedUltraEmail ? (
                                                    <CheckCircleIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                                                ) : (
                                                    <ClipboardIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">
                                            Password:
                                        </label>
                                        <div className="relative">
                                            <div className="bg-white dark:bg-neutral-800 px-3 py-2 rounded border border-blue-200 dark:border-blue-700 flex items-center justify-between">
                                                <span className="text-sm font-mono text-blue-900 dark:text-blue-100">
                                                    {showUltraPassword ? emailDetails.password : '••••••••'}
                                                </span>
                                                <div className="flex items-center gap-1 ml-2">
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            try {
                                                                await navigator.clipboard.writeText(emailDetails.password);
                                                                setCopiedUltraPassword(true);
                                                                setTimeout(() => setCopiedUltraPassword(false), 2000);
                                                            } catch (err) {
                                                                console.error('Failed to copy password:', err);
                                                            }
                                                        }}
                                                        className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-800 rounded transition-colors"
                                                        aria-label="Copy password"
                                                        title="Copy password"
                                                    >
                                                        {copiedUltraPassword ? (
                                                            <CheckCircleIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                                                        ) : (
                                                            <ClipboardIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowUltraPassword(!showUltraPassword)}
                                                        className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-800 rounded transition-colors"
                                                        aria-label={showUltraPassword ? 'Hide password' : 'Show password'}
                                                        title={showUltraPassword ? 'Hide password' : 'Show password'}
                                                    >
                                                        {showUltraPassword ? (
                                                            <EyeOffIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                                        ) : (
                                                            <EyeIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded p-2 mt-2">
                                        <p className="text-xs text-blue-800 dark:text-blue-200">
                                            <strong>Note:</strong> Use these credentials to login to Google Flow for Ultra AI access.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {testStatus === 'testing' && (
                        <div className="flex items-center gap-2 text-sm text-neutral-500">
                            <Spinner /> {T_Api.testing}
                        </div>
                    )}
                    
                    {testResults && (
                        <div className="space-y-2">
                            {testResults.map(result => (
                                <div key={result.service} className={`flex items-start gap-2 text-sm p-2 rounded-md ${result.success ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                                    {result.success ? <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5"/> : <XIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"/>}
                                    <div>
                                        <span className={`font-semibold ${result.success ? 'text-green-800 dark:text-green-200' : 'text-red-700 dark:text-red-300'}`}>{result.service} Service</span>
                                        <p className={`text-xs ${result.success ? 'text-green-700 dark:text-green-300' : 'text-red-600 dark:text-red-400'}`}>{result.message}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="space-y-3">
                        {/* Baris 1: Login Google Flow */}
                        <button
                            onClick={handleOpenFlow}
                            className="w-full flex items-center justify-center gap-2 bg-neutral-300 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-100 text-sm font-semibold py-2.5 px-4 rounded-lg hover:bg-neutral-400 dark:hover:bg-neutral-700 transition-colors shadow-[0px_4px_12px_0px_rgba(0,0,0,0.15)]"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            Login Google Flow
                        </button>
                        
                        {/* Baris 2: Get Token */}
                        <button
                            onClick={handleGetToken}
                            className="w-full flex items-center justify-center gap-2 bg-primary-600 dark:bg-primary-700 text-white text-sm font-semibold py-2.5 px-4 rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors"
                        >
                            <KeyIcon className="w-4 h-4" />
                            Get Token
                        </button>
                        
                        {/* Baris 3: Health Test Button */}
                        <button
                            onClick={handleTestToken}
                            disabled={(!flowToken.trim() && !currentUser?.personalAuthToken) || testStatus === 'testing'}
                            className="w-full flex items-center justify-center gap-2 bg-blue-600 dark:bg-blue-700 text-white text-sm font-semibold py-2.5 px-4 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50"
                        >
                            {testStatus === 'testing' ? <Spinner /> : <SparklesIcon className="w-4 h-4" />}
                            Health Test
                        </button>
                        
                        {/* Status Messages */}
                        {error && (
                            <div className="text-center">
                                <span className="text-sm text-red-600 dark:text-red-400 font-medium flex items-center justify-center gap-1">
                                    <XIcon className="w-4 h-4"/> {error}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                </div>

                {/* Right Panel: Anti-Captcha Configuration */}
                <div className="bg-white dark:bg-neutral-900 p-6 rounded-lg shadow-sm h-full overflow-y-auto">
                    <div className="mb-8">
                        <h3 className="text-base sm:text-lg font-bold mb-4 text-neutral-800 dark:text-neutral-200 flex items-center gap-2">
                            <KeyIcon className="w-5 h-5 text-primary-500" />
                            Anti-Captcha Configuration
                        </h3>

                        <div className="p-3 sm:p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border-[0.5px] border-yellow-200 dark:border-yellow-800 mb-4">
                            <div className="flex items-start gap-2 sm:gap-3">
                                <InformationCircleIcon className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                                <div className="text-[11px] sm:text-xs text-yellow-800 dark:text-yellow-200">
                                    <p className="text-[11px] sm:text-xs font-semibold mb-1">Required for Video/Image Generation</p>
                                    <p className="text-[11px] sm:text-xs">Google API requires reCAPTCHA v3 Enterprise tokens. Enable this to automatically solve captchas using <a href="https://anti-captcha.com" target="_blank" rel="noopener noreferrer" className="underline font-semibold">anti-captcha.com</a> service.</p>
                                </div>
                            </div>
                        </div>

                        {/* Enable Toggle */}
                        <div className="mb-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={enableAntiCaptcha}
                                    onChange={(e) => setEnableAntiCaptcha(e.target.checked)}
                                    className="w-5 h-5 text-primary-600 bg-neutral-100 border-neutral-300 rounded focus:ring-primary-500 dark:focus:ring-primary-600 dark:ring-offset-neutral-800 focus:ring-2 dark:bg-neutral-700 dark:border-neutral-600"
                                />
                                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                                    Enable Anti-Captcha Integration
                                </span>
                            </label>
                        </div>

                        {enableAntiCaptcha && (
                            <div className="space-y-4 pl-8 border-l-2 border-primary-200 dark:border-primary-800">
                                {/* API Key Input */}
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                                        Anti-Captcha API Key *
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showAntiCaptchaKey ? 'text' : 'password'}
                                            value={antiCaptchaApiKey}
                                            onChange={(e) => setAntiCaptchaApiKey(e.target.value)}
                                            placeholder="Enter your anti-captcha.com API key"
                                            className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-2.5 pr-10 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors font-mono text-sm"
                                        />
                                        <div className="absolute inset-y-0 right-0 flex items-center gap-2 pr-2">
                                            {recaptchaTokenSaved && antiCaptchaApiKey.trim() && (
                                                <span className="text-xs text-green-600 dark:text-green-400 font-medium">Saved</span>
                                            )}
                                            {isSavingRecaptcha && (
                                                <Spinner />
                                            )}
                                            <button
                                                onClick={() => setShowAntiCaptchaKey(!showAntiCaptchaKey)}
                                                className="px-3 flex items-center text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                                            >
                                                {showAntiCaptchaKey ? <EyeOffIcon className="w-4 h-4"/> : <EyeIcon className="w-4 h-4"/>}
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                                        Get your API key from <a href="https://anti-captcha.com/clients/settings/apisetup" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">anti-captcha.com dashboard</a>
                                        {antiCaptchaApiKey.trim() && <span className="ml-2 text-green-600 dark:text-green-400">• Auto-saved</span>}
                                    </p>
                                </div>

                                {/* Project ID Input - Admin Only */}
                                {currentUser?.role === 'admin' && (
                                    <div>
                                        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                                            Project ID (Optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={antiCaptchaProjectId}
                                            onChange={(e) => setAntiCaptchaProjectId(e.target.value)}
                                            placeholder="e.g., 92f722f2-8241-4a32-a890-8ac07ffc508b"
                                            className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-2.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors font-mono text-sm"
                                        />
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                                            Leave empty to auto-generate. Used for tracking purposes.
                                        </p>
                                    </div>
                                )}

                                {/* Test Button and Status */}
                                <div className="w-full space-y-2">
                                    <button
                                        onClick={handleTestAntiCaptcha}
                                        disabled={!antiCaptchaApiKey || antiCaptchaTestStatus === 'testing'}
                                        className="w-full px-4 py-2 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {antiCaptchaTestStatus === 'testing' ? <Spinner /> : <SparklesIcon className="w-4 h-4" />}
                                        Test API Key
                                    </button>

                                    {antiCaptchaTestMessage && (
                                        <span className={`text-sm font-medium ${
                                            antiCaptchaTestStatus === 'success' ? 'text-green-600' :
                                            antiCaptchaTestStatus === 'error' ? 'text-red-600' :
                                            'text-neutral-600'
                                        }`}>
                                            {antiCaptchaTestMessage}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FlowLogin;

