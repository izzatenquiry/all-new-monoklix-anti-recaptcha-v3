import React, { useState, useRef, useEffect } from 'react';
import { type User, type TokenUltraRegistration } from '../types';
import { registerTokenUltra, saveUserRecaptchaToken, getTokenUltraRegistration, hasActiveTokenUltra } from '../services/userService';
import { CheckCircleIcon, AlertTriangleIcon, TelegramIcon, XIcon, ClockIcon } from './Icons';
import Spinner from './common/Spinner';

interface RegisterTokenUltraProps {
  currentUser: User;
  onUserUpdate?: (user: User) => void;
}

const RegisterTokenUltra: React.FC<RegisterTokenUltraProps> = ({ currentUser, onUserUpdate }) => {
  const [telegramId, setTelegramId] = useState(currentUser.telegramId || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showTelegramModal, setShowTelegramModal] = useState(false);
  const [registration, setRegistration] = useState<TokenUltraRegistration | null>(null);
  const [isLoadingRegistration, setIsLoadingRegistration] = useState(true);

  // Load registration status on mount
  useEffect(() => {
    const loadRegistration = async () => {
      setIsLoadingRegistration(true);
      const result = await getTokenUltraRegistration(currentUser.id);
      if (result.success) {
        setRegistration(result.registration);
      }
      setIsLoadingRegistration(false);
    };
    loadRegistration();
  }, [currentUser.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!telegramId.trim()) {
      setErrorMessage('Please enter your Telegram ID');
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');
    setErrorMessage(null);

    try {
      const result = await registerTokenUltra(
        currentUser.id,
        telegramId.trim()
      );

      if (result.success) {
        setSubmitStatus('success');
        if (onUserUpdate) {
          onUserUpdate(result.user);
        }
        // Invalidate cache and reload registration status
        sessionStorage.removeItem(`token_ultra_active_${currentUser.id}`);
        sessionStorage.removeItem(`token_ultra_active_timestamp_${currentUser.id}`);
        const regResult = await getTokenUltraRegistration(currentUser.id);
        if (regResult.success) {
          setRegistration(regResult.registration);
        }
        // Force refresh token ultra status cache
        await hasActiveTokenUltra(currentUser.id, true);
        // Show Telegram share modal
        setShowTelegramModal(true);
      } else {
        setSubmitStatus('error');
        setErrorMessage(result.message || 'Failed to register. Please try again.');
      }
    } catch (error) {
      setSubmitStatus('error');
      setErrorMessage('An unexpected error occurred. Please try again.');
      console.error('Registration error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 dark:text-white mb-2">
          Register Token Ultra
        </h2>
        <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-400">
          Register to get your personal Ultra AI token. Complete the form below and make a payment of RM20.
        </p>
      </div>

      {/* Registration Status Section */}
      {!isLoadingRegistration && registration && (
        <div className="mb-6 bg-white dark:bg-neutral-900 rounded-lg shadow-sm p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
            <ClockIcon className="w-5 h-5 text-primary-500" />
            Token Ultra Status
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Status:</span>
              <span className={`text-sm font-semibold px-3 py-1 rounded-full ${
                registration.status === 'active' 
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                  : registration.status === 'expired'
                  ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
              }`}>
                {registration.status === 'active' ? 'Active' : registration.status === 'expired' ? 'Expired' : 'Expiring Soon'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Registration Date:</span>
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                {new Date(registration.registered_at).toLocaleDateString('en-US', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Active Until:</span>
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                {new Date(registration.expires_at).toLocaleDateString('en-US', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </span>
            </div>
            
            {registration.status === 'expired' && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-2">
                <AlertTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">
                    Your Token Ultra Has Expired
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300">
                    Please renew your token by submitting a new payment proof to continue using Token Ultra.
                  </p>
                </div>
              </div>
            )}
            {registration.status === 'expiring_soon' && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 flex items-start gap-2">
                <AlertTriangleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
                    Token Ultra Expiring Soon
                  </p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">
                    Your token will expire soon. Please renew by submitting a new payment proof to avoid service interruption.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Left Panel: Payment Barcode */}
        <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-sm p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">
            Payment Information
          </h3>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
              <strong>Payment Amount:</strong> RM20.00
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              Please scan the barcode below to complete your payment.
            </p>
          </div>
          <div className="bg-white dark:bg-neutral-800 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700">
            <img 
              src="https://monoklix.com/wp-content/uploads/2025/12/WhatsApp-Image-2025-12-29-at-5.30.38-PM.jpeg" 
              alt="Payment Barcode" 
              className="w-full h-auto rounded-lg"
            />
          </div>
        </div>

        {/* Right Panel: Registration Form */}
        <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-sm p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">
            Registration Form
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name Field (Read-only) */}
          <div>
            <label className="block text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
              Name
            </label>
            <input
              type="text"
              value={currentUser.fullName || currentUser.username}
              disabled
              className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg text-neutral-500 dark:text-neutral-400 cursor-not-allowed"
            />
          </div>

          {/* Email Field (Read-only) */}
          <div>
            <label className="block text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
              Email
            </label>
            <input
              type="email"
              value={currentUser.email}
              disabled
              className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg text-neutral-500 dark:text-neutral-400 cursor-not-allowed"
            />
          </div>

          {/* Telegram ID Field */}
          <div>
            <label className="block text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
              Telegram ID <span className="text-red-500">*</span>
            </label>
            <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
              PM telegram bot ini untuk dapatkan Telegram ID anda:{' '}
              <a 
                href="https://t.me/MKAITokenBot" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary-600 dark:text-primary-400 hover:underline font-medium"
              >
                https://t.me/MKAITokenBot
              </a>
            </p>
            <input
              type="text"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              placeholder="Enter your Telegram ID (e.g., @username or 123456789)"
              required
              className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
            />
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Your Telegram ID will be used for payment confirmation and token delivery.
            </p>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800 dark:text-red-200">{errorMessage}</p>
            </div>
          )}

          {/* Success Message */}
          {submitStatus === 'success' && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
              <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-800 dark:text-green-200">
                Registration submitted successfully! We will process your request and contact you via Telegram.
              </p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || submitStatus === 'success'}
            className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Spinner />
                <span>Submitting...</span>
              </>
            ) : submitStatus === 'success' ? (
              <>
                <CheckCircleIcon className="w-5 h-5" />
                <span>Submitted</span>
              </>
            ) : (
              <span>Submit Payment Proof</span>
            )}
          </button>
          </form>
        </div>
      </div>

      {/* Telegram Share Modal */}
      {showTelegramModal && (
        <TelegramShareModal
          userName={currentUser.fullName || currentUser.username}
          userEmail={currentUser.email}
          telegramId={telegramId}
          userId={currentUser.id}
          onClose={() => setShowTelegramModal(false)}
          onUserUpdate={onUserUpdate}
        />
      )}
    </div>
  );
};

// Telegram Share Modal Component
interface TelegramShareModalProps {
  userName: string;
  userEmail: string;
  telegramId: string;
  userId: string;
  onClose: () => void;
  onUserUpdate?: (user: User) => void;
}

const TelegramShareModal: React.FC<TelegramShareModalProps> = ({
  userName,
  userEmail,
  telegramId,
  userId,
  onClose,
  onUserUpdate,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);

  const message = `Token Ultra Registration

Name: ${userName}
Email: ${userEmail}
Telegram ID: ${telegramId}

Please find payment proof attached.`;

  const telegramUrl = `https://t.me/monoklix_support?text=${encodeURIComponent(message)}`;

  const handleOpenTelegram = async () => {
    // Update recaptcha token dengan default API key
    setIsUpdating(true);
    try {
      const defaultApiKey = '414f452fca8c16dedc687934823c7e97';
      const result = await saveUserRecaptchaToken(userId, defaultApiKey);
      
      if (result.success && onUserUpdate) {
        onUserUpdate(result.user);
      }
    } catch (error) {
      console.error('Failed to update recaptcha token:', error);
      // Continue anyway, don't block user from opening Telegram
    } finally {
      setIsUpdating(false);
    }

    // Open Telegram
    window.open(telegramUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex flex-col items-center justify-center z-50 p-4 animate-zoomIn"
      aria-modal="true"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl p-6 sm:p-8 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center">
              <TelegramIcon className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-neutral-900 dark:text-white">
              Share to Telegram
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Share your registration details to <strong>@monoklix_support</strong> via Telegram. The message is pre-filled with your information.
          </p>

          <div className="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-4 border border-neutral-200 dark:border-neutral-700">
            <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
              Message Preview:
            </p>
            <div className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap font-mono bg-white dark:bg-neutral-900 p-3 rounded border border-neutral-200 dark:border-neutral-700">
              {message}
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-xs text-blue-800 dark:text-blue-200">
              <strong>Important:</strong> Please attach your payment proof image (barcode/receipt screenshot) when sending the message in Telegram.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 bg-neutral-200 dark:bg-neutral-700 font-semibold py-3 px-4 rounded-lg hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors text-sm"
            >
              Close
            </button>
            <button
              onClick={handleOpenTelegram}
              disabled={isUpdating}
              className="flex-1 bg-blue-500 text-white font-semibold py-3 px-4 rounded-lg hover:bg-blue-600 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUpdating ? (
                <>
                  <Spinner />
                  <span>Updating...</span>
                </>
              ) : (
                <>
                  <TelegramIcon className="w-4 h-4" />
                  Open Telegram
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisterTokenUltra;

