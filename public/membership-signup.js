// Membership Signup Wizard
// Handles multi-step form for creating new gym memberships

// Get API_BASE and token from global scope (set in app.js)
// These will be available when the script loads after app.js
// Don't redeclare - just reference from window
let membershipAPI_BASE = '/api';
let membershipToken = null;

// Initialize on DOM ready
if (typeof window !== 'undefined') {
    // Try to get from window (set by app.js)
    if (window.API_BASE) {
        membershipAPI_BASE = window.API_BASE;
    }
    if (window.token) {
        membershipToken = window.token;
    } else {
        membershipToken = localStorage.getItem('token');
    }
}

// Helper to get current API_BASE
function getAPIBase() {
    return (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : membershipAPI_BASE;
}

// Helper to get current token
function getToken() {
    return (typeof window !== 'undefined' && window.token) ? window.token : (membershipToken || localStorage.getItem('token'));
}

/** Display YYYY-MM-DD in a readable US format (Mountain-neutral noon parse). */
function formatYmdUs(ymd) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return ymd || '';
    const d = new Date(String(ymd) + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Matches buildMembershipPayload() contract / early-fee math for the selected membership type. */
function getMembershipContractPreview() {
    const today = new Date().toISOString().split('T')[0];
    const contractStart = new Date(today);
    const contractEnd = new Date(contractStart);
    contractEnd.setMonth(contractEnd.getMonth() + 12);
    const contractEndDate = contractEnd.toISOString().split('T')[0];
    const membershipType = formData.membership?.membershipType || 'STANDARD';
    const baseMonthlyDollarsByType = {
        STANDARD: 65,
        IMMEDIATE_FAMILY: 50,
        EXPECTING_RECOVERING: 30,
        FULL_FAMILY: 185
    };
    const monthlyListDollars = baseMonthlyDollarsByType[membershipType] ?? 65;
    const earlyCancellationFeeDollars = Math.max(100, 2 * monthlyListDollars);
    return {
        contractStartYmd: today,
        contractEndYmd: contractEndDate,
        earlyCancellationFeeDollars,
        monthlyListDollars
    };
}

let currentStep = 0;
let formData = {
    profile: {},
    address: {},
    membership: {},
    household: {},
    group: {},
    emergencyContact: {},
    acknowledgements: {},
    billing: {}
};

// Step configuration
const STEPS = [
    { id: 'profile', title: 'Basic Profile' },
    { id: 'household', title: 'Household & Billing' },
    { id: 'address', title: 'Address' },
    { id: 'membership-type', title: 'Membership Type' },
    { id: 'group', title: 'Group Join' },
    { id: 'emergency', title: 'Emergency Contact' },
    { id: 'disclosures', title: 'Disclosures & Waiver' },
    { id: 'billing', title: 'Billing' }
];

// Initialize wizard
function initMembershipSignupWizard() {
    // Reset form data
    formData = {
        profile: {},
        address: {},
        membership: {},
        household: {},
        group: {},
        emergencyContact: {},
        acknowledgements: {},
        billing: {}
    };

    // Optional prefill from home page join flow
    try {
        const prefillRaw = sessionStorage.getItem('prefillMembershipType');
        const prefillType = String(prefillRaw || '').trim().toUpperCase();
        if (prefillType === 'STANDARD' || prefillType === 'IMMEDIATE_FAMILY' || prefillType === 'EXPECTING_RECOVERING' || prefillType === 'FULL_FAMILY') {
            formData.membership.membershipType = prefillType;
        }
        sessionStorage.removeItem('prefillMembershipType');
    } catch (e) {
        // ignore storage errors
    }
    
    // Pre-fill email from current user
    if (typeof currentUser !== 'undefined' && currentUser && currentUser.email) {
        formData.profile.email = currentUser.email;
    } else if (typeof window !== 'undefined' && window.currentUser && window.currentUser.email) {
        formData.profile.email = window.currentUser.email;
    }
    
    currentStep = 0;
    renderStep(0);
    
    // Set up event listeners after a short delay to ensure DOM is ready
    setTimeout(() => {
        setupWizardEventListeners();
    }, 100);
}

// Make init function globally available
window.initMembershipSignupWizard = initMembershipSignupWizard;

// Define openMembershipSignupWizard early so it's available
function openMembershipSignupWizard() {
    const wizardContainer = document.getElementById('membershipSignupWizard');
    if (wizardContainer) {
        wizardContainer.style.display = 'block';
        initMembershipSignupWizard();
    }
}
window.openMembershipSignupWizard = openMembershipSignupWizard;

// Setup event listeners (only once)
let eventListenersSetup = false;
function setupWizardEventListeners() {
    // Only set up listeners once to prevent duplicate handlers
    if (eventListenersSetup) {
        return;
    }
    eventListenersSetup = true;
    
    // Next/Previous buttons - use event delegation on the wizard container
    const wizardContainer = document.getElementById('membershipSignupWizard');
    if (wizardContainer) {
        wizardContainer.addEventListener('click', (e) => {
            if (e.target.matches('#membershipWizardNext')) {
                e.preventDefault();
                e.stopPropagation();
                handleNext();
            } else if (e.target.matches('#membershipWizardPrev')) {
                e.preventDefault();
                e.stopPropagation();
                handlePrev();
            } else if (e.target.matches('#membershipWizardSubmit')) {
                e.preventDefault();
                e.stopPropagation();
                handleSubmit();
            } else if (e.target.matches('#membershipWizardClose')) {
                e.preventDefault();
                e.stopPropagation();
                closeWizard();
            }
        });
    }
    
    // Membership type change handler
    document.addEventListener('change', (e) => {
        if (e.target.matches('#membershipType')) {
            handleMembershipTypeChange(e.target.value);
        }
    });
    
    // Household linking handlers
    document.addEventListener('change', (e) => {
        if (e.target.matches('#linkToHousehold')) {
            handleHouseholdLinkChange(e.target.value);
        } else if (e.target.matches('#billingMode')) {
            handleBillingModeChange(e.target.value);
        }
    });
    
    // Group join handler
    document.addEventListener('change', (e) => {
        if (e.target.matches('#joinGroup')) {
            handleGroupJoinChange(e.target.value);
        }
    });
    
    // Household ID validation is now triggered when billing mode is selected (see setBillingMode function)
    
    // Group code validation
    document.addEventListener('blur', async (e) => {
        if (e.target.matches('#groupCode')) {
            await validateGroupCode(e.target.value);
        }
    });
    
    // Clear EXPECTING_RECOVERING selection if gender changes to non-FEMALE
    document.addEventListener('change', (e) => {
        if (e.target.matches('#gender')) {
            const gender = e.target.value;
            if (gender !== 'FEMALE' && formData.membership.membershipType === 'EXPECTING_RECOVERING') {
                formData.membership.membershipType = '';
                // Re-render membership type step if we're on it
                if (currentStep === 3) { // membership-type step (now step 3 after reordering)
                    renderStep(currentStep);
                }
            }
        }
    });
    
    // Date of birth formatting - auto-advance after year
    document.addEventListener('input', (e) => {
        if (e.target.matches('#dateOfBirth')) {
            formatDateOfBirth(e.target);
        }
    });
    
    // Phone number formatting
    document.addEventListener('input', (e) => {
        if (e.target.matches('#phone')) {
            formatPhoneNumber(e.target);
        } else if (e.target.matches('#emergencyContactPhone')) {
            formatPhoneNumber(e.target);
        }
    });
    
    // Real-time error clearing - only remove errors when field becomes valid (don't add errors)
    document.addEventListener('input', (e) => {
        const input = e.target;
        // Only clear errors if they exist - don't validate
        if (input.classList.contains('field-error') || input.style.borderColor === '#ef4444') {
            const formGroup = input.closest('.form-group');
            if (formGroup) {
                // Check if field is now valid
                let isValid = false;
                if (input.tagName === 'SELECT') {
                    isValid = input.value && input.value.trim() !== '';
                } else if (input.type === 'checkbox') {
                    isValid = input.checked;
                } else {
                    isValid = input.value && input.value.trim() !== '';
                }
                
                if (isValid) {
                    // Remove error styling only if field is now valid
                    input.style.borderColor = '';
                    input.classList.remove('field-error');
                    const errorMsg = formGroup.querySelector('.field-error-message');
                    if (errorMsg) {
                        errorMsg.remove();
                    }
                }
            }
        }
    });
    
    // Real-time error clearing for checkboxes
    document.addEventListener('change', (e) => {
        const input = e.target;
        if (input.type === 'checkbox' && input.hasAttribute('required')) {
            const label = input.closest('label');
            if (label && (label.classList.contains('field-error') || label.style.color === '#ef4444')) {
                if (input.checked) {
                    label.style.color = '';
                    label.classList.remove('field-error');
                    const errorMsg = label.querySelector('.field-error-message');
                    if (errorMsg) {
                        errorMsg.remove();
                    }
                }
            }
        }
    });
}

// Render current step
function renderStep(stepIndex) {
    currentStep = stepIndex;
    const wizardContainer = document.getElementById('membershipSignupWizard');
    if (!wizardContainer) return;
    
    const step = STEPS[stepIndex];
    if (!step) return;
    
    let stepHTML = '';
    
    switch(step.id) {
        case 'profile':
            stepHTML = renderProfileStep();
            break;
        case 'address':
            stepHTML = renderAddressStep();
            break;
        case 'membership-type':
            stepHTML = renderMembershipTypeStep();
            break;
        case 'household':
            stepHTML = renderHouseholdStep();
            break;
        case 'group':
            stepHTML = renderGroupStep();
            break;
        case 'emergency':
            stepHTML = renderEmergencyStep();
            break;
        case 'disclosures':
            stepHTML = renderDisclosuresStep();
            break;
        case 'billing':
            stepHTML = renderBillingStep();
            break;
    }
    
    // Wrap content in a div to match CSS selector .wizard-modal > div
    // Use a form with novalidate to prevent HTML5 validation from showing errors before Next is clicked
    wizardContainer.innerHTML = `
        <form novalidate>
            <div>
                <div class="wizard-header">
                    <h2>Gym Membership Signup</h2>
                    <button type="button" id="membershipWizardClose" class="wizard-close-btn">×</button>
                </div>
                <div class="wizard-progress">
                    ${STEPS.map((s, i) => `
                        <div class="wizard-progress-step ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'completed' : ''}">
                            <div class="wizard-progress-number">${i + 1}</div>
                            <div class="wizard-progress-label">${s.title}</div>
                        </div>
                    `).join('')}
                </div>
                <div class="wizard-content">
                    ${stepHTML}
                </div>
            <div class="wizard-actions">
                ${stepIndex > 0 ? `<button type="button" id="membershipWizardPrev" class="btn btn-secondary">Previous</button>` : ''}
                <div style="flex: 1;"></div>
                ${stepIndex < STEPS.length - 1 
                    ? `<button type="button" id="membershipWizardNext" class="btn btn-primary">Next</button>`
                    : `<button type="button" id="membershipWizardSubmit" class="btn btn-primary">Submit</button>`
                }
            </div>
        </form>
    `;
    
    // After rendering, explicitly clear any error styling to ensure clean start
    // Validation should ONLY happen when Next is clicked, not on render
    setTimeout(() => {
        const stepContent = wizardContainer.querySelector('.wizard-step-content');
        if (stepContent) {
            // Clear all error messages
            stepContent.querySelectorAll('.field-error-message').forEach(msg => msg.remove());
            // Clear error styling
            stepContent.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
            // Clear inline border colors
            stepContent.querySelectorAll('input, select, textarea').forEach(input => {
                input.style.borderColor = '';
            });
            // Clear label error colors
            stepContent.querySelectorAll('label').forEach(label => {
                if (label.style.color === '#ef4444' && !label.querySelector('.required-indicator')) {
                    label.style.color = '';
                }
            });
            
            // Restore household ID validation result if previously validated
            if (step.id === 'household' && formData.household.isValidated && formData.household.validationResult) {
                const resultDiv = document.getElementById('householdIdValidationResult');
                if (resultDiv) {
                    resultDiv.innerHTML = formData.household.validationResult;
                }
            }
            
            // Initialize waiver state if on disclosures step
            if (step.id === 'disclosures') {
                const waiverContainer = document.getElementById('waiverContainer');
                const waiverFade = document.getElementById('waiverFade');
                if (waiverContainer && waiverFade) {
                    // Ensure waiver starts collapsed
                    waiverContainer.style.maxHeight = '500px';
                    waiverFade.style.display = 'block';
                }
                
                // Initialize checkbox state
                const checkbox = document.getElementById('waiverAccept');
                const checkboxDiv = document.getElementById('waiverCheckbox');
                const checkmark = document.getElementById('waiverCheckmark');
                if (checkbox && checkboxDiv && checkmark) {
                    if (checkbox.checked) {
                        checkboxDiv.style.borderColor = '#047857';
                        checkboxDiv.style.background = 'rgba(4, 120, 87, 0.12)';
                        checkmark.style.display = 'block';
                    } else {
                        checkboxDiv.style.borderColor = '#d1d5db';
                        checkboxDiv.style.background = '#ffffff';
                        checkmark.style.display = 'none';
                    }
                }
                
                // Ensure expecting/recovering attest checkbox is clickable (label click toggles it)
                const attestCheckbox = document.getElementById('expectingRecoveringAttest');
                const attestLabel = attestCheckbox ? attestCheckbox.closest('label') : null;
                if (attestLabel && attestCheckbox) {
                    attestLabel.addEventListener('click', function(e) {
                        e.preventDefault();
                        attestCheckbox.checked = !attestCheckbox.checked;
                    });
                }
            }
            
            // Initialize Stripe Elements if on billing step
            if (step.id === 'billing') {
                setTimeout(() => {
                    initializeStripePaymentElement();
                }, 100);
            }
            
            // Scroll active step into view and center it in the progress bar
            const progressContainer = wizardContainer.querySelector('.wizard-progress');
            if (progressContainer) {
                const activeStep = progressContainer.querySelector('.wizard-progress-step.active');
                if (activeStep) {
                    // Use setTimeout to ensure DOM is fully rendered
                    setTimeout(() => {
                        // Calculate the position to center the active step
                        const containerRect = progressContainer.getBoundingClientRect();
                        const stepRect = activeStep.getBoundingClientRect();
                        const scrollLeft = progressContainer.scrollLeft;
                        const stepCenter = stepRect.left - containerRect.left + scrollLeft + (stepRect.width / 2);
                        const containerCenter = progressContainer.clientWidth / 2;
                        const targetScroll = stepCenter - containerCenter;
                        
                        progressContainer.scrollTo({
                            left: Math.max(0, targetScroll),
                            behavior: 'smooth'
                        });
                    }, 200);
                }
            }
        }
    }, 0);
}

// Step 1: Basic Profile — field order + required/optional match config/gym-member-profile-schema.js
function renderProfileStep() {
    const g = (formData.profile.gender || '').toUpperCase();
    return `
        <div class="wizard-step-content">
            <h3>Basic Profile Information</h3>
            <div class="form-group">
                <label for="firstName">First name <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <input type="text" id="firstName" required value="${formData.profile.firstName || ''}" placeholder="First name">
            </div>
            <div class="form-group">
                <label for="lastName">Last name <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <input type="text" id="lastName" required value="${formData.profile.lastName || ''}" placeholder="Last name">
            </div>
            <div class="form-group">
                <label for="gender">Gender <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <select id="gender" required>
                    <option value="">Select gender</option>
                    <option value="MALE" ${g === 'MALE' ? 'selected' : ''}>Male</option>
                    <option value="FEMALE" ${g === 'FEMALE' ? 'selected' : ''}>Female</option>
                    <option value="PREFER_NOT_TO_SAY" ${g === 'PREFER_NOT_TO_SAY' ? 'selected' : ''}>Prefer not to say</option>
                </select>
            </div>
            <div class="form-group">
                <label for="phone">Phone <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <input type="tel" id="phone" required value="${formatPhoneForDisplay(formData.profile.phone)}" placeholder="(555) 555-5555" maxlength="14">
            </div>
            <div class="form-group">
                <label for="email">Email <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <input type="email" id="email" required value="${formData.profile.email || ''}" readonly>
            </div>
            <div class="form-group">
                <label for="dateOfBirth">Date of birth <span style="color: #6b7280; font-size: 0.875rem;">(optional)</span></label>
                <input type="text" id="dateOfBirth" value="${formatDateForDisplay(formData.profile.dateOfBirth)}" placeholder="MM/DD/YYYY" maxlength="10">
                <small style="display: block; margin-top: 0.25rem; color: #6b7280; font-size: 0.875rem;">Format: MM/DD or MM/DD/YYYY</small>
            </div>
        </div>
    `;
}

// Step 3: Address (moved after household)
function renderAddressStep() {
    // Populate address from primary member if household ID was validated
    if (formData.household.primaryMemberAddress && !formData.address.street) {
        const address = formData.household.primaryMemberAddress;
        formData.address.street = address.street || '';
        formData.address.city = address.city || '';
        formData.address.state = address.state || '';
        formData.address.zip = address.zip || '';
    }
    
    return `
        <div class="wizard-step-content">
            <h3>Address Information</h3>
            ${formData.household.primaryMemberAddress && formData.household.primaryMemberAddress.street ? `
                <div class="info-message" style="margin-bottom: 1rem; padding: 1rem; background: #dbeafe; border: 1px solid #93c5fd; border-radius: 4px; color: #1e40af;">
                    <strong>ℹ️ Address Pre-filled:</strong> Your address has been pre-filled from the primary member's information. You can edit it if needed.
                </div>
            ` : ''}
            <div class="form-group">
                <label for="street">Street address <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <input type="text" id="street" required value="${formData.address.street || ''}" placeholder="Street address">
            </div>
            <div class="form-group">
                <label for="city">City <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <input type="text" id="city" required value="${formData.address.city || ''}" placeholder="City">
            </div>
            <div class="form-group">
                <label for="state">State <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <input type="text" id="state" required value="${formData.address.state || ''}" maxlength="2" placeholder="UT">
            </div>
            <div class="form-group">
                <label for="zip">Zip code <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <input type="text" id="zip" required value="${formData.address.zip || ''}" placeholder="84664" pattern="[0-9]{5}(-[0-9]{4})?">
            </div>
        </div>
    `;
}

// Step 3: Membership Type
function renderMembershipTypeStep() {
    const selectedType = formData.membership.membershipType || '';
    const gender = formData.profile.gender || '';
    const showExpectingWarning = selectedType === 'EXPECTING_RECOVERING' && gender !== 'FEMALE';
    // Only show EXPECTING_RECOVERING option for FEMALE gender
    const canSelectExpectingRecovering = gender === 'FEMALE';
    
    return `
        <div class="wizard-step-content">
            <h3>Select Membership Type</h3>
            <div class="form-group">
                <label for="membershipType">Membership Type <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <select id="membershipType" required>
                    <option value="">Select Membership Type</option>
                    <option value="STANDARD" ${selectedType === 'STANDARD' ? 'selected' : ''}>Standard - $65/month</option>
                    <option value="IMMEDIATE_FAMILY" ${selectedType === 'IMMEDIATE_FAMILY' ? 'selected' : ''}>Immediate Family - $50/month</option>
                    ${canSelectExpectingRecovering ? `<option value="EXPECTING_RECOVERING" ${selectedType === 'EXPECTING_RECOVERING' ? 'selected' : ''}>Expecting or Recovering Mother - $30/month</option>` : ''}
                    <option value="FULL_FAMILY" ${selectedType === 'FULL_FAMILY' ? 'selected' : ''}>Full Family - $185/month</option>
                </select>
            </div>
            ${showExpectingWarning ? `
                <div class="error-message" style="margin-top: 1rem; padding: 1rem; background: #fee2e2; border: 1px solid #fecaca; border-radius: 4px; color: #991b1b;">
                    <strong>⚠️ Eligibility Required:</strong> The "Expecting or Recovering Mother" membership is only available to females. Please select a different membership type or update your gender selection.
                </div>
            ` : ''}
            ${selectedType === 'EXPECTING_RECOVERING' && gender === 'FEMALE' ? `
                <div class="info-message" style="margin-top: 1rem; padding: 1rem; background: #dbeafe; border: 1px solid #93c5fd; border-radius: 4px; color: #1e40af;">
                    <strong>ℹ️ Special Membership:</strong> This membership is designed for expecting or recovering mothers. You will be asked to confirm your eligibility later in the signup process.
                </div>
            ` : ''}
            ${selectedType === 'FULL_FAMILY' ? `
                <div class="form-group" style="margin-top: 1rem;">
                    <label for="familyMemberCount">Number of Family Members (minimum 4) <span class="required-indicator" style="color: #ef4444;">*</span></label>
                    <input type="number" id="familyMemberCount" required min="4" value="${formData.family?.familyMemberCount || '4'}">
                </div>
            ` : ''}
        </div>
    `;
}

// Step 4: Household & Billing
function renderHouseholdStep() {
    const membershipType = formData.membership.membershipType || '';
    const linkToHousehold = formData.household.linkToHousehold || '';
    const billingMode = formData.household.billingMode || '';
    
    if (membershipType === 'FULL_FAMILY') {
        // FULL_FAMILY: Always PRIMARY, system generates householdId
        return `
            <div class="wizard-step-content">
                <h3>Household & Billing Setup</h3>
                <p>As a Full Family membership holder, you will be the primary member of this household.</p>
                <p>The system will automatically generate a Household ID for you.</p>
            </div>
        `;
    }
    
    if (membershipType === 'STANDARD') {
        // STANDARD: Can be PRIMARY or DEPENDENT
        // Ensure we have a clean value
        const householdLinkValue = linkToHousehold === 'yes' ? 'yes' : (linkToHousehold === 'no' ? 'no' : '');
        
        let conditionalContent = '';
        if (householdLinkValue === 'yes') {
            const savedHouseholdId = formData.household.householdId || '';
            conditionalContent = `
                <div class="form-group" style="margin-top: 1rem;">
                    <label for="householdId">Household ID <span class="required-indicator" style="color: #ef4444;">*</span></label>
                    <input type="text" id="householdId" required placeholder="Enter the household ID (e.g., HH-123456)" style="text-transform: uppercase;" value="${savedHouseholdId}">
                    <p class="form-help-text" style="margin-top: 0.5rem; font-size: 0.875rem; color: #6b7280;">
                        You can get this Household ID from the household's primary member.
                    </p>
                    <div id="householdIdValidationResult" style="margin-top: 0.5rem;"></div>
                </div>
            `;
        } else if (householdLinkValue === 'no') {
            conditionalContent = `
                <div class="info-message" style="margin-top: 1rem; padding: 1rem; background: #dbeafe; border: 1px solid #93c5fd; border-radius: 4px; color: #1e40af;">
                    <strong>You will be added as the Primary Member of your household.</strong>
                    <p style="margin: 0.75rem 0 0 0; line-height: 1.5;">
                        As the primary member, you are the main account holder who manages the household. This means you can:
                    </p>
                    <ul style="margin: 0.5rem 0 0 0; padding-left: 1.5rem; line-height: 1.5;">
                        <li>Add family members to your household account</li>
                        <li>Manage billing and payments for the household</li>
                        <li>Receive a Household ID that you can share with family members who want to join your household</li>
                    </ul>
                    <p style="margin: 0.75rem 0 0 0; line-height: 1.5;">
                        The system will automatically generate a Household ID for you that you can use to add family members later.
                    </p>
                </div>
            `;
        }
        
        return `
            <div class="wizard-step-content">
                <h3>Household & Billing Setup</h3>
                <div class="form-group">
                    <label>Are you joining under an existing household?</label>
                    <div class="button-choice-group">
                        <button type="button" class="btn btn-choice btn-choice-left ${householdLinkValue === 'no' ? 'active' : ''}" data-value="no" onclick="setHouseholdLink('no')">
                            No
                        </button>
                        <button type="button" class="btn btn-choice btn-choice-right ${householdLinkValue === 'yes' ? 'active' : ''}" data-value="yes" onclick="setHouseholdLink('yes')">
                            Yes
                        </button>
                    </div>
                    <input type="hidden" id="linkToHousehold" value="${householdLinkValue}">
                </div>
                ${conditionalContent}
            </div>
        `;
    }
    
    // IMMEDIATE_FAMILY or EXPECTING_RECOVERING
    return `
        <div class="wizard-step-content">
            <h3>Household & Billing Setup</h3>
            <div class="form-group">
                <label>Do you want to link to an existing household?</label>
                <div class="button-choice-group">
                    <button type="button" class="btn btn-choice btn-choice-left ${linkToHousehold === 'no' ? 'active' : ''}" data-value="no" onclick="setHouseholdLink('no')">
                        No
                    </button>
                    <button type="button" class="btn btn-choice btn-choice-right ${linkToHousehold === 'yes' ? 'active' : ''}" data-value="yes" onclick="setHouseholdLink('yes')">
                        Yes
                    </button>
                </div>
                <input type="hidden" id="linkToHousehold" value="${linkToHousehold}">
            </div>
            ${linkToHousehold === 'yes' ? `
                <div class="form-group" style="margin-top: 1rem;">
                    <label for="householdId">Household ID <span class="required-indicator" style="color: #ef4444;">*</span></label>
                    <input type="text" id="householdId" required placeholder="Enter the household ID (e.g., HH-123456)" style="text-transform: uppercase;" value="${formData.household.householdId || ''}">
                    <p class="form-help-text" style="margin-top: 0.5rem; font-size: 0.875rem; color: #6b7280;">
                        Enter the Household ID provided by the primary member of the household.
                    </p>
                    <div id="householdIdValidationResult" style="margin-top: 0.5rem;"></div>
                </div>
                <div class="form-group" style="margin-top: 1rem;">
                    <label>Who pays for this membership? <span class="required-indicator" style="color: #ef4444;">*</span></label>
                    <div class="button-choice-group">
                        <button type="button" class="btn btn-choice btn-choice-left ${billingMode === 'BILL_TO_PRIMARY' ? 'active' : ''}" data-value="BILL_TO_PRIMARY" onclick="setBillingMode('BILL_TO_PRIMARY')">
                            Primary Member Pays (Dependent)
                        </button>
                        <button type="button" class="btn btn-choice btn-choice-right ${billingMode === 'BILL_TO_SELF' ? 'active' : ''}" data-value="BILL_TO_SELF" onclick="setBillingMode('BILL_TO_SELF')">
                            I Pay for Myself (Independent)
                        </button>
                    </div>
                    <input type="hidden" id="billingMode" value="${billingMode}">
                    <p class="form-help-text" style="margin-top: 0.5rem; font-size: 0.875rem; color: #6b7280;">
                        <strong>Dependent:</strong> The primary member will be billed for your membership.<br>
                        <strong>Independent:</strong> You will be billed separately for your own membership.
                    </p>
                </div>
            ` : `
                <div class="info-message" style="margin-top: 1rem; padding: 1rem; background: #dbeafe; border: 1px solid #93c5fd; border-radius: 4px; color: #1e40af;">
                    <strong>Independent Member:</strong> You will be set as an independent member who pays your own fees and is not linked to a primary member.
                </div>
            `}
        </div>
    `;
}

// Step 5: Group Join
function renderGroupStep() {
    // Handle both boolean and string values for backward compatibility
    const joinGroupValue = formData.group.joinGroup;
    const joinGroup = typeof joinGroupValue === 'boolean' 
        ? (joinGroupValue ? 'yes' : 'no')
        : (joinGroupValue || '');
    
    const groupAction = formData.group.groupAction || ''; // 'join' or 'create'
    
    // DEBUG: Log the state when rendering
    console.log('=== RENDERING GROUP STEP ===');
    console.log('joinGroup:', joinGroup);
    console.log('groupAction:', groupAction);
    console.log('formData.group.groupId:', formData.group.groupId);
    console.log('formData.group.groupName:', formData.group.groupName);
    console.log('Should show success?', !!formData.group.groupId);
    
    return `
        <div class="wizard-step-content">
            <h3>Group Membership (Optional)</h3>
            <div class="form-group">
                <label>Are you joining a group?</label>
                <div class="button-choice-group">
                    <button type="button" class="btn btn-choice btn-choice-left ${joinGroup === 'no' ? 'active' : ''}" data-value="no" onclick="setGroupJoin('no')">
                        No
                    </button>
                    <button type="button" class="btn btn-choice btn-choice-right ${joinGroup === 'yes' ? 'active' : ''}" data-value="yes" onclick="setGroupJoin('yes')">
                        Yes
                    </button>
                </div>
                <input type="hidden" id="joinGroup" value="${joinGroup}">
            </div>
            ${joinGroup === 'yes' ? `
                <div class="form-group" style="margin-top: 1rem;">
                    <label>What would you like to do? <span class="required-indicator" style="color: #ef4444;">*</span></label>
                    <div class="button-choice-group">
                        <button type="button" class="btn btn-choice btn-choice-left ${groupAction === 'join' ? 'active' : ''}" data-value="join" onclick="window.setGroupAction('join')">
                            Enter Group Code
                        </button>
                        <button type="button" class="btn btn-choice btn-choice-right ${groupAction === 'create' ? 'active' : ''}" data-value="create" onclick="window.setGroupAction('create')">
                            Create New Group
                        </button>
                    </div>
                    <input type="hidden" id="groupAction" value="${groupAction}">
                </div>
                ${groupAction === 'join' ? `
                    <div class="form-group" style="margin-top: 1rem;">
                        <label for="groupCode">Group Code <span class="required-indicator" style="color: #ef4444;">*</span></label>
                        <input type="text" id="groupCode" required placeholder="Enter your group code" style="text-transform: uppercase;">
                        <div id="groupCodeValidationResult" style="margin-top: 0.5rem;"></div>
                        <p class="form-help-text" style="margin-top: 0.5rem; font-size: 0.875rem; color: #6b7280;">
                            Enter the 6-character group code provided by your group leader.
                        </p>
                    </div>
                ` : ''}
                ${groupAction === 'create' ? `
                    <div class="form-group" style="margin-top: 1rem;">
                        ${!formData.group.groupId ? `
                            <label for="groupName">Group Name <span class="required-indicator" style="color: #ef4444;">*</span></label>
                            <input type="text" id="groupName" required placeholder="Enter a name for your group" value="${formData.group.groupName || ''}">
                            <p class="form-help-text" style="margin-top: 0.5rem; font-size: 0.875rem; color: #6b7280;">
                                You will become the group leader. Groups need at least 5 members to receive the 15% discount.
                            </p>
                        ` : `
                            <div id="groupSuccessMessage" style="padding: 1.5rem; background: #047857; border: 2px solid rgba(255,255,255,0.25); border-radius: 8px; color: #ffffff; margin-top: 1rem;">
                                <strong style="font-size: 1.2rem; display: block; margin-bottom: 1rem;">✓ Group Created Successfully!</strong>
                                <div style="margin-bottom: 1rem;">
                                    <strong style="font-size: 1rem;">Group Name:</strong> 
                                    <span style="font-size: 1rem; font-weight: bold; color: #ffffff;">${formData.group.groupName || '(Not set)'}</span>
                                </div>
                                <small style="display: block; margin-top: 0.5rem; color: rgba(255,255,255,0.92);">Once you have completed your registration, you will receive a code that you can give to other people to join your group. Groups need at least 5 members to receive the 15% discount.</small>
                            </div>
                        `}
                    </div>
                ` : ''}
            ` : ''}
        </div>
    `;
}

// Step 6: Emergency Contact
function renderEmergencyStep() {
    return `
        <div class="wizard-step-content">
            <h3>Emergency Contact (Optional)</h3>
            <p style="margin-bottom: 1rem; color: #6b7280;">You can skip this step if you prefer.</p>
            <div class="form-group">
                <label for="emergencyContactName">Emergency contact name</label>
                <input type="text" id="emergencyContactName" value="${formData.emergencyContact.name || ''}" placeholder="Emergency contact name">
            </div>
            <div class="form-group">
                <label for="emergencyContactPhone">Emergency contact phone</label>
                <input type="tel" id="emergencyContactPhone" value="${formatPhoneForDisplay(formData.emergencyContact.phone || '')}" placeholder="(555) 555-5555" maxlength="14" oninput="formatPhoneNumber(this)">
            </div>
        </div>
    `;
}

// Step 7: Disclosures & Waiver
function renderDisclosuresStep() {
    const membershipType = formData.membership.membershipType || '';
    const isExpectingRecovering = membershipType === 'EXPECTING_RECOVERING';
    const waiverAccepted = formData.acknowledgements?.waiverAcceptedAt ? true : false;
    const contractPrev = getMembershipContractPreview();
    const startDisp = formatYmdUs(contractPrev.contractStartYmd);
    const endDisp = formatYmdUs(contractPrev.contractEndYmd);
    const earlyFee = contractPrev.earlyCancellationFeeDollars;
    const contractAckChecked = !!(formData.acknowledgements && formData.acknowledgements.membershipContractTermsAcceptedAt);
    
    return `
        <div class="wizard-step-content">
            <div style="margin-bottom: 1.75rem; padding: 1.25rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 12px;">
                <h3 style="margin: 0 0 0.75rem 0; font-size: 1.05rem; font-weight: 700; color: #0f172a;">Membership contract &amp; billing</h3>
                <p style="margin: 0 0 0.75rem 0; font-size: 0.875rem; color: #334155; line-height: 1.55;">
                    Please read and confirm you understand the following before you sign the waiver below.
                </p>
                <ul style="margin: 0 0 1rem 1.1rem; padding: 0; color: #334155; font-size: 0.875rem; line-height: 1.55;">
                    <li style="margin-bottom: 0.35rem;"><strong>Contract term:</strong> Your membership agreement runs from <strong>${startDisp}</strong> through <strong>${endDisp}</strong> (12-month term). Billing continues monthly until the term ends or you cancel under our policy.</li>
                    <li style="margin-bottom: 0.35rem;"><strong>Early cancellation:</strong> Ending your membership early may result in an early-cancellation fee of <strong>$${earlyFee.toFixed(2)}</strong> (two months of your plan&rsquo;s monthly rate, minimum $100), charged per membership rules.</li>
                    <li><strong>Pause:</strong> You may use <strong>one free pause</strong> per 12-month period for <strong>one billing cycle</strong>; it takes effect at your <strong>next</strong> billing date (not mid-cycle).</li>
                </ul>
                <label style="display: flex; align-items: flex-start; gap: 0.65rem; cursor: pointer; margin: 0;">
                    <input type="checkbox" id="membershipContractAck" required style="margin-top: 0.2rem; width: 18px; height: 18px; min-width: 18px; flex-shrink: 0; accent-color: #2563eb;" ${contractAckChecked ? 'checked' : ''}>
                    <span style="font-size: 0.875rem; color: #0f172a; line-height: 1.5;">I acknowledge the contract dates above, the early cancellation fee, and the one free pause per 12-month period. <span style="color: #ef4444; font-weight: 600;">*</span></span>
                </label>
            </div>
            <div style="margin-bottom: 2rem;">
                <h3 style="margin: 0 0 0.5rem 0; font-size: 1.5rem; font-weight: 700; color: #111827; letter-spacing: -0.025em;">Waiver and Release of Liability</h3>
            </div>
            
            <div class="form-group" style="margin-top: 0;">
                <div id="waiverContainer" style="max-height: 500px; overflow: hidden; position: relative; transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1); background: #ffffff; border: 2px solid #e5e7eb; border-radius: 12px; padding: 2rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
                    <div id="waiverContent" style="line-height: 1.8; color: #374151; font-size: 0.9375rem; padding-right: 0.5rem;">
                        <div style="margin-bottom: 1.5rem; padding: 1rem; background: #eff6ff; border-left: 4px solid #2563eb; border-radius: 4px;">
                            <p style="margin: 0; color: #1e40af; font-size: 0.9375rem; line-height: 1.6; font-weight: 500;">
                                <strong>Important:</strong> By completing this membership signup, you are registering for a physical gym membership at Stoic Fitness, a fitness facility with in-person access to equipment, classes, and training services. This is not a digital-only or app-only subscription.
                            </p>
                        </div>
                        <p style="margin: 0 0 1.75rem 0; color: #4b5563; line-height: 1.7;">By signing this Waiver and Release of Liability, I acknowledge and agree to the following terms as a member, participant, or visitor at Stoic Fitness.</p>
                        
                        <div style="margin-bottom: 1.75rem;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Assumption of Risk</h5>
                            <p style="margin: 0; color: #4b5563; line-height: 1.7;">I understand that participation in fitness activities, exercise programs, training sessions, classes, and use of gym equipment involves inherent risks, including but not limited to muscle strains, sprains, falls, equipment failure, overexertion, illness, serious injury, or death. I voluntarily choose to participate and fully assume all risks associated with my participation, whether known or unknown, foreseeable or unforeseeable.</p>
                        </div>
                        
                        <div style="margin-bottom: 1.75rem;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Medical Responsibility</h5>
                            <p style="margin: 0; color: #4b5563; line-height: 1.7;">I represent that I am physically and medically able to participate in fitness activities. I acknowledge that Stoic Fitness does not provide medical advice, diagnosis, or treatment. I am solely responsible for monitoring my physical condition and for stopping exercise if I experience pain, discomfort, dizziness, or other concerning symptoms.</p>
                        </div>
                        
                        <div style="margin-bottom: 1.75rem;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Release of Liability</h5>
                            <p style="margin: 0; color: #4b5563; line-height: 1.7;">To the fullest extent permitted by law, I hereby waive, release, and discharge Stoic Fitness, its owners, employees, instructors, contractors, volunteers, and affiliates (collectively, the "Released Parties") from any and all claims, demands, actions, damages, liabilities, costs, or expenses arising out of or related to my participation in any activities at Stoic Fitness, including but not limited to claims based on negligence, premises liability, or equipment use.</p>
                        </div>
                        
                        <div style="margin-bottom: 1.75rem;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Children at the Gym – No Daycare Provided</h5>
                            <p style="margin: 0 0 0.75rem 0; color: #4b5563; line-height: 1.7;">I acknowledge that Stoic Fitness does not provide childcare or supervision for children.</p>
                            <p style="margin: 0 0 0.75rem 0; color: #4b5563; line-height: 1.7;">Children are permitted to be present at the gym at the discretion of Stoic Fitness, provided they are:</p>
                            <ul style="margin: 0 0 0.75rem 1.75rem; padding: 0; color: #4b5563; list-style-type: disc; line-height: 1.8;">
                                <li style="margin-bottom: 0.5rem;">Directly supervised by a parent or legal guardian at all times</li>
                                <li style="margin-bottom: 0.5rem;">Kept away from workout areas, equipment, and active members</li>
                                <li style="margin-bottom: 0.5rem;">Not disruptive to classes, training sessions, or other members</li>
                            </ul>
                            <p style="margin: 0; color: #4b5563; line-height: 1.7;">I understand and agree that I am solely responsible for the safety, supervision, and behavior of any child I bring into the facility. Stoic Fitness assumes no responsibility or liability for injuries, accidents, or incidents involving children on the premises.</p>
                        </div>
                        
                        <div style="margin-bottom: 1.75rem;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Equipment Use & Facility Safety</h5>
                            <p style="margin: 0; color: #4b5563; line-height: 1.7;">I agree to use all equipment properly and as intended. I understand that improper use of equipment or failure to follow posted rules or instructor guidance may result in injury. I accept full responsibility for my actions while using Stoic Fitness facilities and equipment.</p>
                        </div>
                        
                        <div style="margin-bottom: 1.75rem;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Conduct & Gym Etiquette</h5>
                            <p style="margin: 0 0 0.75rem 0; color: #4b5563; line-height: 1.7;">I agree to:</p>
                            <ul style="margin: 0 0 0.75rem 1.75rem; padding: 0; color: #4b5563; list-style-type: disc; line-height: 1.8;">
                                <li style="margin-bottom: 0.5rem;">Wear appropriate athletic clothing and footwear</li>
                                <li style="margin-bottom: 0.5rem;">Use respectful and appropriate language</li>
                                <li style="margin-bottom: 0.5rem;">Treat staff, instructors, and other members with respect</li>
                                <li style="margin-bottom: 0.5rem;">Follow all posted rules and instructor guidance</li>
                            </ul>
                            <p style="margin: 0; color: #4b5563; line-height: 1.7;">Stoic Fitness reserves the right to suspend or terminate membership or access for behavior deemed unsafe, disruptive, or inappropriate, without refund.</p>
                        </div>
                        
                        <div style="margin-bottom: 1.75rem;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Insurance</h5>
                            <p style="margin: 0; color: #4b5563; line-height: 1.7;">I acknowledge that I am responsible for maintaining my own health, accident, and liability insurance coverage. Stoic Fitness does not provide insurance coverage for members, participants, or guests.</p>
                        </div>
                        
                        <div style="margin-bottom: 1.75rem;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Photo & Video Release (Optional but Recommended)</h5>
                            <p style="margin: 0; color: #4b5563; line-height: 1.7;">I grant Stoic Fitness permission to use photographs or video recordings taken of me while participating in activities for promotional, marketing, or educational purposes, without compensation.</p>
                        </div>
                        
                        <div style="margin-bottom: 1.75rem;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Severability</h5>
                            <p style="margin: 0; color: #4b5563; line-height: 1.7;">If any portion of this Waiver is found to be invalid or unenforceable, the remaining provisions shall remain in full force and effect.</p>
                        </div>
                        
                        <div style="margin-bottom: 0;">
                            <h5 style="margin: 0 0 0.875rem 0; font-size: 0.875rem; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Acknowledgment & Agreement</h5>
                            <p style="margin: 0 0 0.75rem 0; color: #4b5563; line-height: 1.7;">By signing below (or by digitally accepting this Waiver), I confirm that:</p>
                            <ul style="margin: 0; padding: 0; color: #4b5563; list-style-type: disc; margin-left: 1.75rem; line-height: 1.8;">
                                <li style="margin-bottom: 0.5rem;">I have read and fully understand this Waiver</li>
                                <li style="margin-bottom: 0.5rem;">I voluntarily agree to its terms</li>
                                <li style="margin-bottom: 0;">I understand that I am giving up certain legal rights</li>
                            </ul>
                        </div>
                    </div>
                    <div id="waiverFade" style="position: absolute; bottom: 0; left: 0; right: 0; height: 100px; background: linear-gradient(to bottom, rgba(255, 255, 255, 0), #ffffff 100%); pointer-events: none; border-radius: 0 0 12px 12px;"></div>
                </div>
                <button type="button" id="waiverToggle" onclick="toggleWaiver()" onmouseover="this.style.color='#1d4ed8'; this.style.backgroundColor='#eff6ff';" onmouseout="this.style.color='#2563eb'; this.style.backgroundColor='transparent';" style="margin-top: 1.25rem; background: transparent; border: 1px solid #dbeafe; border-radius: 8px; color: #2563eb; cursor: pointer; font-size: 0.875rem; font-weight: 600; padding: 0.625rem 1.25rem; display: inline-flex; align-items: center; gap: 0.5rem; transition: all 0.2s ease;">
                    <span>Show Full Waiver</span>
                    <svg style="width: 16px; height: 16px; transition: transform 0.3s ease;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                    </svg>
                </button>
            </div>
            
            <div class="form-group" style="margin-top: 2rem; padding: 1.5rem; background: #ffffff; border: 2px solid #e5e7eb; border-radius: 12px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);">
                <label style="display: flex; align-items: start; gap: 0.75rem; cursor: pointer; margin: 0 0 1.25rem 0;" onclick="event.preventDefault(); toggleWaiverCheckbox();">
                    <div id="waiverCheckbox" style="margin-top: 0.25rem; width: 24px; height: 24px; min-width: 24px; min-height: 24px; flex-shrink: 0; border: 2px solid #d1d5db; border-radius: 4px; background: #ffffff; display: flex; align-items: center; justify-content: center; transition: all 0.2s; cursor: pointer;">
                        <svg id="waiverCheckmark" style="width: 16px; height: 16px; display: none; color: #047857;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
                        </svg>
                    </div>
                    <input type="checkbox" id="waiverAccept" required style="position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0;" ${formData.acknowledgements?.waiverAcceptedAt ? 'checked' : ''}>
                    <span style="font-size: 0.9375rem; line-height: 1.6; color: #374151; font-weight: 500; user-select: none;">I have read and agree to the Waiver and Release of Liability above. <span class="required-indicator" style="color: #ef4444; font-weight: 600;">*</span></span>
                </label>
                <div style="margin-top: 1rem;">
                    <label for="waiverSignature" style="display: block; margin-bottom: 0.5rem; font-size: 0.9375rem; font-weight: 500; color: #374151;">
                        Type your full name to acknowledge <span class="required-indicator" style="color: #ef4444; font-weight: 600;">*</span>
                    </label>
                    <input type="text" id="waiverSignature" required placeholder="Enter your full name" style="width: 100%; padding: 0.75rem; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 0.9375rem; color: #111827; transition: border-color 0.2s;" onfocus="this.style.borderColor='#2563eb';" onblur="validateWaiverSignature(); this.style.borderColor='#e5e7eb';" oninput="validateWaiverSignature();" value="${formData.acknowledgements?.waiverSignature || ''}">
                    <div id="waiverSignatureError" style="margin-top: 0.5rem; color: #ef4444; font-size: 0.875rem; display: none;"></div>
                </div>
            </div>
            
            ${isExpectingRecovering ? `
                <div class="form-group" style="margin-top: 1.5rem; padding: 1.5rem; background: #ffffff; border: 2px solid #e5e7eb; border-radius: 12px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);">
                    <label for="expectingRecoveringAttest" style="display: flex; align-items: start; gap: 0.75rem; cursor: pointer; margin: 0;">
                        <input type="checkbox" id="expectingRecoveringAttest" required style="margin-top: 0.125rem; width: 22px; height: 22px; min-width: 22px; min-height: 22px; cursor: pointer; accent-color: #2563eb; flex-shrink: 0;">
                        <span style="font-size: 0.9375rem; line-height: 1.6; color: #374151; font-weight: 500;">I attest that I am expecting or recovering from childbirth. <span class="required-indicator" style="color: #ef4444; font-weight: 600;">*</span></span>
                    </label>
                </div>
            ` : ''}
        </div>
    `;
}

// Step 8: Billing
function renderBillingStep() {
    // Calculate membership price for display
    const membershipType = formData.membership?.membershipType || 'STANDARD';
    const amount = calculateMembershipPrice(membershipType);
    const formattedAmount = (amount / 100).toFixed(2);
    
    return `
        <div class="wizard-step-content">
            <h3>Billing Information</h3>
            <div class="form-group" style="margin-bottom: 1.5rem;">
                <p style="font-size: 1rem; font-weight: 600; color: #111827; margin-bottom: 0.5rem;">
                    Membership Fee: $${formattedAmount}
                </p>
                <p class="form-help-text" style="margin-top: 0; font-size: 0.875rem; color: #6b7280;">
                    Please enter your payment information below. Your payment will be securely processed by Stripe.
                </p>
            </div>
            <div class="form-group">
                <label>Payment Method <span class="required-indicator" style="color: #ef4444;">*</span></label>
                <div id="membershipPaymentElement" style="min-height: 200px;">
                    <!-- Stripe Elements will be mounted here -->
                    <p style="color: #6b7280; padding: 1rem; text-align: center;">Loading secure payment form...</p>
                </div>
            </div>
            <div style="margin-top: 1rem; padding: 0.75rem; background: #f3f4f6; border-radius: 4px; font-size: 0.875rem; color: #6b7280;">
                <strong>Secure Payment:</strong> Your payment information is encrypted and processed securely by Stripe. We never store your full card details.
            </div>
        </div>
    `;
}

// Handle next step
async function handleNext() {
    // Store the current step index to avoid any race conditions
    const currentStepIndex = currentStep;
    
    console.log('=== handleNext called ===');
    console.log('Current step index:', currentStepIndex);
    console.log('Current step name:', STEPS[currentStepIndex]?.title);
    
    // Validate we have a valid step
    if (currentStepIndex < 0 || currentStepIndex >= STEPS.length) {
        console.error('ERROR: Invalid currentStep index:', currentStepIndex);
        return;
    }
    
    // First validate the CURRENT step (before collecting data or moving forward)
    if (!validateCurrentStep()) {
        console.log('Validation failed for step', currentStepIndex);
        return;
    }
    console.log('Validation passed for step', currentStepIndex);
    
    // If on group step (index 4, which is step 5) and user selected 'create', handle it BEFORE collecting data
    if (currentStepIndex === 4 && formData.group.joinGroup === 'yes' && formData.group.groupAction === 'create' && !formData.group.groupId) {
        // Collect group name first (before creating)
        const groupNameInput = document.getElementById('groupName');
        if (groupNameInput && groupNameInput.value) {
            formData.group.groupName = groupNameInput.value.trim();
        }
        
        const createResult = await createGroupIfNeeded();
        if (createResult.error) {
            // Show error and don't proceed
            const wizardContainer = document.getElementById('membershipSignupWizard');
            const stepContent = wizardContainer?.querySelector('.wizard-step-content');
            if (stepContent) {
                const groupNameInput = document.getElementById('groupName');
                if (groupNameInput) {
                    groupNameInput.style.borderColor = '#ef4444';
                    groupNameInput.classList.add('field-error');
                    const formGroup = groupNameInput.closest('.form-group');
                    if (formGroup) {
                        const existingError = formGroup.querySelector('.field-error-message');
                        if (existingError) existingError.remove();
                        const errorDiv = document.createElement('div');
                        errorDiv.className = 'field-error-message';
                        errorDiv.style.color = '#dc2626';
                        errorDiv.style.marginTop = '0.5rem';
                        errorDiv.textContent = createResult.error;
                        formGroup.appendChild(errorDiv);
                    }
                }
            }
            return;
        }
        // If group was created, re-render to show success message and stay on this step
        if (createResult.success) {
            console.log('=== GROUP CREATION SUCCESS ===');
            console.log('Re-rendering group step (index 4) with success message');
            // Re-render the current step (group step, index 4) without changing the step index
            renderStep(4);
            return; // Stay on this step
        }
    }
    
    // Collect data from current step
    collectCurrentStepData();
    
    // Special handling for certain steps
    if (currentStepIndex === 2) { // Membership type step
        const membershipType = formData.membership.membershipType;
        const gender = formData.profile.gender;
        
        if (membershipType === 'EXPECTING_RECOVERING' && gender !== 'FEMALE') {
            alert('The "Expecting or Recovering Mother" membership is only available to females. Please select a different membership type or update your gender.');
            return;
        }
    }
    
    // Calculate next step - exactly one step forward (NEVER skip steps)
    const nextStepIndex = currentStepIndex + 1;
    
    // Check bounds
    if (nextStepIndex >= STEPS.length) {
        console.error('ERROR: Cannot go to next step - already on last step');
        return;
    }
    
    // CRITICAL: Verify the next step exists and is exactly one step forward
    if (!STEPS[nextStepIndex]) {
        console.error('ERROR: Next step does not exist! nextStepIndex:', nextStepIndex);
        return;
    }
    
    // CRITICAL: Ensure we're moving exactly one step forward
    if (nextStepIndex !== currentStepIndex + 1) {
        console.error('ERROR: Step calculation error! Expected:', currentStepIndex + 1, 'Got:', nextStepIndex);
        return;
    }
    
    console.log('=== MOVING TO NEXT STEP ===');
    console.log('Current step index:', currentStepIndex);
    console.log('Current step:', STEPS[currentStepIndex]?.id, '-', STEPS[currentStepIndex]?.title);
    console.log('Next step index:', nextStepIndex);
    console.log('Next step:', STEPS[nextStepIndex]?.id, '-', STEPS[nextStepIndex]?.title);
    console.log('All steps:', STEPS.map((s, i) => `[${i}] ${s.id}`).join(', '));
    
    // CRITICAL: Double-check we're going to the correct next step
    if (nextStepIndex !== currentStepIndex + 1) {
        console.error('FATAL: Step calculation is wrong!');
        console.error('Current:', currentStepIndex, 'Expected next:', currentStepIndex + 1, 'Calculated:', nextStepIndex);
        return;
    }
    
    // Move to next step - renderStep will update currentStep
    renderStep(nextStepIndex);
    
    // Verify we're on the correct step after rendering
    if (currentStep !== nextStepIndex) {
        console.error('ERROR: Step mismatch after render! Expected:', nextStepIndex, 'Got:', currentStep);
        // Force correct step
        currentStep = nextStepIndex;
        renderStep(nextStepIndex);
    }
    console.log('After renderStep, currentStep is:', currentStep, '(', STEPS[currentStep]?.title, ')');
    
    // Clear any error messages and styling from the NEW step after rendering
    // This ensures a fresh start for each step
    setTimeout(() => {
        const wizardContainer = document.getElementById('membershipSignupWizard');
        if (wizardContainer) {
            const stepContent = wizardContainer.querySelector('.wizard-step-content');
            if (stepContent) {
                // Clear all error messages
                stepContent.querySelectorAll('.field-error-message').forEach(msg => msg.remove());
                // Clear error styling
                stepContent.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
                const inputs = stepContent.querySelectorAll('input, select, textarea');
                inputs.forEach(input => {
                    input.style.borderColor = '';
                });
                const labels = stepContent.querySelectorAll('label');
                labels.forEach(label => {
                    if (label.style.color === '#ef4444') {
                        label.style.color = '';
                    }
                });
            }
        }
    }, 50);
}

// Handle previous step
function handlePrev() {
    // Store the current step index to avoid any race conditions
    const currentStepIndex = currentStep;
    
    console.log('=== handlePrev called ===');
    console.log('Current step index:', currentStepIndex);
    console.log('Current step name:', STEPS[currentStepIndex]?.title);
    
    // Validate we have a valid step
    if (currentStepIndex < 0 || currentStepIndex >= STEPS.length) {
        console.error('ERROR: Invalid currentStep index:', currentStepIndex);
        return;
    }
    
    // Can't go back from first step
    if (currentStepIndex === 0) {
        console.log('Already on first step, cannot go back');
        return;
    }
    
    // Collect data from current step before moving back
    collectCurrentStepData();
    
    // Calculate previous step - exactly one step backward
    const prevStepIndex = currentStepIndex - 1;
    
    console.log('=== MOVING TO PREVIOUS STEP ===');
    console.log('From step:', currentStepIndex, '(', STEPS[currentStepIndex]?.title, ')');
    console.log('To step:', prevStepIndex, '(', STEPS[prevStepIndex]?.title, ')');
    
    // Move to previous step - renderStep will update currentStep
    renderStep(prevStepIndex);
}

// Validate current step
function validateCurrentStep() {
    const step = STEPS[currentStep];
    if (!step) {
        return false;
    }
    
    // Special case: If on group step (index 4) and group was already created, skip validation
    if (currentStep === 4 && formData.group.groupAction === 'create' && formData.group.groupId) {
        return true; // Group already created, allow proceeding
    }
    
    // Find the wizard content container - make sure we're checking the right one
    const wizardContainer = document.getElementById('membershipSignupWizard');
    if (!wizardContainer) {
        return false;
    }
    
    // Find the wizard-content div within the rendered step
    const container = wizardContainer.querySelector('.wizard-content');
    if (!container) {
        return false;
    }
    
    // Only check inputs that are actually visible in the current step
    // Use a more specific selector to ensure we're only checking the current step's fields
    const stepContent = container.querySelector('.wizard-step-content');
    if (!stepContent) {
        return false;
    }
    
    // Clear all previous error messages and styling (but keep required indicators)
    // This ensures we start fresh for each validation attempt - no errors shown until Next is clicked
    stepContent.querySelectorAll('.field-error-message').forEach(msg => msg.remove());
    stepContent.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
    stepContent.querySelectorAll('input, select, textarea').forEach(input => {
        input.style.borderColor = '';
    });
    stepContent.querySelectorAll('label').forEach(label => {
        if (label.style.color === '#ef4444') {
            label.style.color = '';
        }
    });
    
    // Get required inputs only from the current step's content
    const requiredInputs = stepContent.querySelectorAll('input[required], select[required], textarea[required]');
    
    // If no required inputs, step is valid (like emergency contact step)
    if (requiredInputs.length === 0) {
        return true;
    }
    
    let isValid = true;
    const invalidFields = [];
    
    requiredInputs.forEach(input => {
        // Skip hidden inputs (they're used for button choice values)
        if (input.type === 'hidden') {
            return;
        }
        
        // Skip disabled inputs
        if (input.disabled) {
            return;
        }
        
        // Find the form group container
        const formGroup = input.closest('.form-group');
        let fieldIsValid = true;
        
        // For select elements, check if a value is selected
        if (input.tagName === 'SELECT') {
            if (!input.value || input.value.trim() === '') {
                fieldIsValid = false;
                isValid = false;
                invalidFields.push(input);
                input.style.borderColor = '#ef4444';
                input.classList.add('field-error');
            } else {
                input.style.borderColor = '';
                input.classList.remove('field-error');
            }
        } else if (input.type === 'checkbox') {
            // For checkboxes, check if they're checked
            if (!input.checked) {
                fieldIsValid = false;
                isValid = false;
                invalidFields.push(input);
                // Highlight the label or container instead
                const label = input.closest('label');
                if (label) {
                    label.style.color = '#ef4444';
                    label.classList.add('field-error');
                }
            } else {
                const label = input.closest('label');
                if (label) {
                    label.style.color = '';
                    label.classList.remove('field-error');
                }
            }
        } else {
            // For text inputs, check if they have a value
            const value = input.value ? input.value.trim() : '';
            if (!value) {
                fieldIsValid = false;
                isValid = false;
                invalidFields.push(input);
                input.style.borderColor = '#ef4444';
                input.classList.add('field-error');
            } else {
                input.style.borderColor = '';
                input.classList.remove('field-error');
            }
        }
        
        // Add error message if field is invalid
        if (!fieldIsValid && formGroup) {
            // Remove existing error message
            const existingError = formGroup.querySelector('.field-error-message');
            if (existingError) {
                existingError.remove();
            }
            
            // Add error message
            const errorMsg = document.createElement('div');
            errorMsg.className = 'field-error-message';
            errorMsg.textContent = 'This field is required';
            errorMsg.style.cssText = 'color: #ef4444; font-size: 0.875rem; margin-top: 0.25rem;';
            formGroup.appendChild(errorMsg);
        } else if (formGroup) {
            // Remove error message if field is valid
            const existingError = formGroup.querySelector('.field-error-message');
            if (existingError) {
                existingError.remove();
            }
        }
    });
    
    // Check waiver acceptance and signature for disclosures step
    if (step.id === 'disclosures') {
        const contractAck = document.getElementById('membershipContractAck');
        if (!contractAck?.checked) {
            isValid = false;
            const contractBox = contractAck?.closest('div');
            if (contractBox && !contractBox.querySelector('.contract-ack-error')) {
                const errorMsg = document.createElement('div');
                errorMsg.className = 'contract-ack-error field-error-message';
                errorMsg.textContent = 'Please acknowledge the membership contract, cancellation fee, and pause policy to continue.';
                errorMsg.style.cssText = 'color: #ef4444; font-size: 0.875rem; margin-top: 0.5rem;';
                contractBox.appendChild(errorMsg);
            }
        } else {
            const contractBox = contractAck?.closest('div');
            const existingContractErr = contractBox?.querySelector('.contract-ack-error');
            if (existingContractErr) existingContractErr.remove();
        }

        const waiverCheckbox = document.getElementById('waiverAccept');
        const waiverSignature = document.getElementById('waiverSignature');
        
        // Check if checkbox is checked
        if (!waiverCheckbox?.checked) {
            isValid = false;
            const label = waiverCheckbox?.closest('label');
            if (label && !label.querySelector('.field-error-message')) {
                const errorMsg = document.createElement('div');
                errorMsg.className = 'field-error-message';
                errorMsg.textContent = 'You must accept the waiver to continue';
                errorMsg.style.cssText = 'color: #ef4444; font-size: 0.875rem; margin-top: 0.25rem;';
                label.appendChild(errorMsg);
            }
        }
        
        // Check if signature is filled
        const signatureValue = waiverSignature?.value?.trim() || '';
        if (!signatureValue) {
            isValid = false;
            waiverSignature.style.borderColor = '#ef4444';
            const errorDiv = document.getElementById('waiverSignatureError');
            if (errorDiv) {
                errorDiv.textContent = 'Please enter your full name';
                errorDiv.style.display = 'block';
            }
        } else {
            // Validate signature matches first and last name
            const firstName = formData.profile.firstName || '';
            const lastName = formData.profile.lastName || '';
            const expectedName = `${firstName} ${lastName}`.trim();
            
            const normalizedSignature = signatureValue.toLowerCase().replace(/\s+/g, ' ').trim();
            const normalizedExpected = expectedName.toLowerCase().replace(/\s+/g, ' ').trim();
            
            if (normalizedSignature !== normalizedExpected) {
                isValid = false;
                waiverSignature.style.borderColor = '#ef4444';
                const errorDiv = document.getElementById('waiverSignatureError');
                if (errorDiv) {
                    errorDiv.textContent = `Name must match your first and last name: ${expectedName}`;
                    errorDiv.style.display = 'block';
                }
            }
        }
        
        const membershipType = formData.membership.membershipType;
        if (membershipType === 'EXPECTING_RECOVERING') {
            const expectingAttest = document.getElementById('expectingRecoveringAttest');
            if (!expectingAttest?.checked) {
                isValid = false;
                const label = expectingAttest?.closest('label');
                if (label && !label.querySelector('.field-error-message')) {
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'field-error-message';
                    errorMsg.textContent = 'This field is required';
                    errorMsg.style.cssText = 'color: #ef4444; font-size: 0.875rem; margin-top: 0.25rem;';
                    label.appendChild(errorMsg);
                }
            }
        }
    }
    
    if (!isValid) {
        // Scroll to first invalid field
        if (invalidFields.length > 0) {
            invalidFields[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            invalidFields[0].focus();
        }
    }
    
    return isValid;
}

// Collect data from current step
function collectCurrentStepData() {
    const step = STEPS[currentStep];
    if (!step) return;
    
    switch(step.id) {
        case 'profile':
            // Get date of birth and convert from MM/DD/YYYY to YYYY-MM-DD for storage
            let dobValue = document.getElementById('dateOfBirth')?.value || '';
            let dobFormatted = '';
            if (dobValue) {
                // If already in YYYY-MM-DD format, use it
                if (dobValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    dobFormatted = dobValue;
                } else if (dobValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                    // Convert from MM/DD/YYYY to YYYY-MM-DD
                    const parts = dobValue.split('/');
                    dobFormatted = `${parts[2]}-${parts[0]}-${parts[1]}`;
                } else {
                    dobFormatted = dobValue;
                }
            }
            
            // Get phone and remove formatting for storage (store as digits only)
            let phoneValue = document.getElementById('phone')?.value || '';
            const phoneDigits = phoneValue.replace(/\D/g, '');
            
            formData.profile = {
                firstName: document.getElementById('firstName')?.value || '',
                lastName: document.getElementById('lastName')?.value || '',
                dateOfBirth: dobFormatted,
                phone: phoneDigits, // Store as digits only
                gender: document.getElementById('gender')?.value || '',
                email: document.getElementById('email')?.value || formData.profile.email || ''
            };
            break;
        case 'address':
            formData.address = {
                street: document.getElementById('street')?.value || '',
                city: document.getElementById('city')?.value || '',
                state: document.getElementById('state')?.value || '',
                zip: document.getElementById('zip')?.value || ''
            };
            break;
        case 'membership-type':
            formData.membership.membershipType = document.getElementById('membershipType')?.value || '';
            if (formData.membership.membershipType === 'FULL_FAMILY') {
                formData.family = {
                    isFamilyPass: true,
                    familyMemberCount: parseInt(document.getElementById('familyMemberCount')?.value || '4')
                };
            }
            break;
        case 'household':
            formData.household.linkToHousehold = document.getElementById('linkToHousehold')?.value || '';
            const membershipType = formData.membership.membershipType || '';
            if (membershipType === 'STANDARD') {
                // STANDARD uses household ID when linking to existing household
                if (formData.household.linkToHousehold === 'yes') {
                    formData.household.householdId = document.getElementById('householdId')?.value?.toUpperCase().trim() || '';
                }
            } else if (membershipType === 'IMMEDIATE_FAMILY' || membershipType === 'EXPECTING_RECOVERING') {
                // IMMEDIATE_FAMILY and EXPECTING_RECOVERING use household ID
                formData.household.householdId = document.getElementById('householdId')?.value?.toUpperCase().trim() || '';
            }
            formData.household.billingMode = document.getElementById('billingMode')?.value || '';
            break;
        case 'group':
            // CRITICAL: Preserve existing groupCode, groupId, and groupName BEFORE collecting new data
            const existingGroupCode = formData.group.groupCode;
            const existingGroupId = formData.group.groupId;
            const existingGroupName = formData.group.groupName;
            
            formData.group.joinGroup = document.getElementById('joinGroup')?.value === 'yes';
            formData.group.groupAction = document.getElementById('groupAction')?.value || '';
            
            if (formData.group.joinGroup && formData.group.groupAction === 'join') {
                formData.group.groupCode = document.getElementById('groupCode')?.value?.toUpperCase().trim() || null;
            } else if (formData.group.joinGroup && formData.group.groupAction === 'create') {
                // Collect group name from input
                const groupNameInput = document.getElementById('groupName');
                if (groupNameInput && groupNameInput.value) {
                    formData.group.groupName = groupNameInput.value.trim();
                } else if (existingGroupName) {
                    // Preserve existing group name if input is empty but we have one
                    formData.group.groupName = existingGroupName;
                }
                // CRITICAL: ALWAYS preserve groupCode and groupId if they already exist (group was already created)
                if (existingGroupCode) {
                    formData.group.groupCode = existingGroupCode;
                }
                if (existingGroupId) {
                    formData.group.groupId = existingGroupId;
                }
            } else {
                // Only clear if user selected 'no' or switched away from group
                if (formData.group.joinGroup === 'no' || !formData.group.joinGroup) {
                    formData.group.groupCode = null;
                    formData.group.groupId = null;
                    formData.group.groupName = null;
                }
            }
            break;
        case 'emergency':
            formData.emergencyContact = {
                name: document.getElementById('emergencyContactName')?.value || null,
                phone: document.getElementById('emergencyContactPhone')?.value || null
            };
            break;
        case 'disclosures':
            const now = new Date().toISOString();
            const contractAckEl = document.getElementById('membershipContractAck');
            const waiverCheckbox = document.getElementById('waiverAccept');
            const waiverSignature = document.getElementById('waiverSignature')?.value?.trim() || '';
            formData.acknowledgements = {
                membershipContractTermsAcceptedAt: contractAckEl?.checked ? now : null,
                membershipDisclosureAcceptedAt: null,
                waiverAcceptedAt: waiverCheckbox?.checked ? now : null,
                waiverSignature: waiverCheckbox?.checked && waiverSignature ? waiverSignature : null,
                expectingRecoveringSelfAttestAt: document.getElementById('expectingRecoveringAttest')?.checked ? now : null
            };
            if (formData.membership.membershipType === 'EXPECTING_RECOVERING' && formData.acknowledgements.expectingRecoveringSelfAttestAt) {
                formData.expectingRecovering = {
                    isEligible: true,
                    selfAttestedAt: now
                };
            }
            break;
        case 'billing':
            // Use the authenticated user's email instead of collecting it
            const userEmail = formData.profile.email || 
                            (typeof currentUser !== 'undefined' && currentUser?.email) ||
                            (typeof window !== 'undefined' && window.currentUser?.email) ||
                            '';
            formData.billing = {
                billingEmail: userEmail
            };
            break;
    }
}

// Handle membership type change
function handleMembershipTypeChange(value) {
    formData.membership.membershipType = value;
    // Re-render step to show/hide relevant fields
    renderStep(currentStep);
}

// Handle household link change
function handleHouseholdLinkChange(value) {
    formData.household.linkToHousehold = value;
    renderStep(currentStep);
}

// Handle billing mode change
function handleBillingModeChange(value) {
    formData.household.billingMode = value;
}

// Handle group join change
function handleGroupJoinChange(value) {
    formData.group.joinGroup = value === 'yes';
    renderStep(currentStep);
}

// Validate group code
async function validateGroupCode(groupCode) {
    if (!groupCode) return;
    
    const resultDiv = document.getElementById('groupCodeValidationResult');
    if (!resultDiv) return;
    
    // Normalize group code (uppercase, trim)
    const normalizedCode = groupCode.toUpperCase().trim();
    
    // Get fresh token
    const currentToken = getToken();
    if (!currentToken) {
        resultDiv.innerHTML = '<span style="color: #dc2626;">Please log in first</span>';
        return;
    }
    
    // Basic format validation (6 alphanumeric characters)
    if (!normalizedCode.match(/^[A-Z0-9]{6}$/)) {
        resultDiv.innerHTML = '<span style="color: #dc2626;">Invalid format. Expected: 6 alphanumeric characters</span>';
        return;
    }
    
    resultDiv.innerHTML = '<span style="color: #6b7280;">Validating...</span>';
    
    try {
        const apiBase = getAPIBase();
        const response = await fetch(`${apiBase}/gym-memberships/validate-group-code?groupCode=${encodeURIComponent(normalizedCode)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        const data = await response.json();
        
        if (data.valid) {
            resultDiv.innerHTML = `<span style="color: #059669;">✓ Valid group code</span>`;
            // Store the group ID
            if (data.groupId) {
                formData.group.groupId = data.groupId;
            }
            if (data.groupAccessCode) {
                formData.group.groupCode = data.groupAccessCode;
            }
        } else {
            resultDiv.innerHTML = `<span style="color: #dc2626;">✗ ${data.error || 'Invalid group code'}</span>`;
        }
    } catch (error) {
        console.error('Error validating group code:', error);
        resultDiv.innerHTML = '<span style="color: #dc2626;">Error validating group code. Please try again.</span>';
    }
}

// Validate household ID
async function validateHouseholdId(householdId) {
    if (!householdId) {
        const resultDiv = document.getElementById('householdIdValidationResult');
        if (resultDiv) {
            resultDiv.innerHTML = '<span style="color: #dc2626;">Please enter a household ID</span>';
        }
        return false;
    }
    
    const resultDiv = document.getElementById('householdIdValidationResult');
    if (!resultDiv) return false;
    
    const householdIdInput = document.getElementById('householdId');
    if (householdIdInput) {
        householdIdInput.style.borderColor = '';
        householdIdInput.classList.remove('field-error');
    }
    
    // Normalize household ID (uppercase, trim)
    const normalizedId = householdId.toUpperCase().trim();
    
    // Get fresh token
    const currentToken = getToken();
    if (!currentToken) {
        resultDiv.innerHTML = '<span style="color: #dc2626;">Please log in first</span>';
        return false;
    }
    
    // Basic format validation
    if (!normalizedId.match(/^HH-[A-Z0-9]{6}$/)) {
        resultDiv.innerHTML = '<span style="color: #dc2626;">Invalid format. Expected: HH-XXXXXX</span>';
        if (householdIdInput) {
            householdIdInput.style.borderColor = '#dc2626';
            householdIdInput.classList.add('field-error');
        }
        return false;
    }
    
    resultDiv.innerHTML = '<span style="color: #6b7280;">Validating...</span>';
    
    try {
        const apiBase = getAPIBase();
        const response = await fetch(`${apiBase}/gym-memberships/validate-household/${encodeURIComponent(normalizedId)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        const data = await response.json();
        
        // Debug logging
        console.log('Household validation response:', data);
        
        if (data.valid) {
            let displayMessage = '<span style="color: #059669;">✓ Valid household ID</span>';
            
            // Show primary member info (name and email) - always show if available
            if (data.primaryMemberName || data.primaryMemberEmail) {
                let primaryInfo = '';
                if (data.primaryMemberName && data.primaryMemberEmail) {
                    primaryInfo = `${data.primaryMemberName} (${data.primaryMemberEmail})`;
                } else if (data.primaryMemberName) {
                    primaryInfo = data.primaryMemberName;
                } else if (data.primaryMemberEmail) {
                    primaryInfo = data.primaryMemberEmail;
                }
                
                if (primaryInfo) {
                    displayMessage += `<br><span style="color: #6b7280; font-size: 0.875rem; margin-top: 0.25rem; display: block;">Primary Member: ${primaryInfo}</span>`;
                }
            } else {
                console.warn('No primary member name or email in response:', data);
            }
            
            resultDiv.innerHTML = displayMessage;
            
            // Store the primary member info for later use
            if (data.primaryMemberEmail) {
                formData.household.primaryMemberEmail = data.primaryMemberEmail;
            }
            if (data.primaryMemberName) {
                formData.household.primaryMemberName = data.primaryMemberName;
            }
            
            // Store primary member address and populate immediately if address fields exist
            if (data.primaryMemberAddress) {
                console.log('Primary member address received:', data.primaryMemberAddress);
                formData.household.primaryMemberAddress = data.primaryMemberAddress;
                
                // Populate address fields immediately if they exist on the page
                const address = data.primaryMemberAddress;
                let addressPopulated = false;
                
                if (address.street) {
                    const streetInput = document.getElementById('street');
                    if (streetInput) {
                        streetInput.value = address.street;
                        formData.address.street = address.street;
                        addressPopulated = true;
                        console.log('Populated street:', address.street);
                    } else {
                        console.log('Street input not found on page');
                    }
                }
                if (address.city) {
                    const cityInput = document.getElementById('city');
                    if (cityInput) {
                        cityInput.value = address.city;
                        formData.address.city = address.city;
                        addressPopulated = true;
                        console.log('Populated city:', address.city);
                    } else {
                        console.log('City input not found on page');
                    }
                }
                if (address.state) {
                    const stateInput = document.getElementById('state');
                    if (stateInput) {
                        stateInput.value = address.state;
                        formData.address.state = address.state;
                        addressPopulated = true;
                        console.log('Populated state:', address.state);
                    } else {
                        console.log('State input not found on page');
                    }
                }
                if (address.zip) {
                    const zipInput = document.getElementById('zip');
                    if (zipInput) {
                        zipInput.value = address.zip;
                        formData.address.zip = address.zip;
                        addressPopulated = true;
                        console.log('Populated zip:', address.zip);
                    } else {
                        console.log('Zip input not found on page');
                    }
                }
                
                // Show a notification that address was populated
                if (addressPopulated) {
                    displayMessage += `<br><span style="color: #059669; font-size: 0.875rem; margin-top: 0.25rem; display: block;">✓ Address populated from primary member</span>`;
                    resultDiv.innerHTML = displayMessage;
                } else {
                    console.log('Address fields not found on current page - will be populated on address step');
                    displayMessage += `<br><span style="color: #059669; font-size: 0.875rem; margin-top: 0.25rem; display: block;">✓ Address will be populated on next step</span>`;
                    resultDiv.innerHTML = displayMessage;
                }
            } else {
                console.log('No primary member address in response');
            }
            
            // Store the normalized household ID in formData
            formData.household.householdId = normalizedId;
            
            // Store validation result for restoration when navigating back
            formData.household.validationResult = displayMessage;
            formData.household.isValidated = true;
            
            // Update the input field with normalized ID
            if (householdIdInput && householdIdInput.value !== normalizedId) {
                householdIdInput.value = normalizedId;
            }
            
            return true;
        } else {
            resultDiv.innerHTML = `<span style="color: #dc2626;">✗ ${data.error || 'Household ID not found'}</span>`;
            if (householdIdInput) {
                householdIdInput.style.borderColor = '#dc2626';
                householdIdInput.classList.add('field-error');
            }
            return false;
        }
    } catch (error) {
        console.error('Error validating household ID:', error);
        resultDiv.innerHTML = '<span style="color: #dc2626;">Error validating household ID. Please try again.</span>';
        if (householdIdInput) {
            householdIdInput.style.borderColor = '#dc2626';
            householdIdInput.classList.add('field-error');
        }
        return false;
    }
}

// Lookup primary member by email
async function lookupPrimaryMember(email) {
    if (!email) return;
    
    const resultDiv = document.getElementById('primaryMemberLookupResult');
    if (!resultDiv) return;
    
    // Get fresh token
    const currentToken = getToken();
    if (!currentToken) {
        resultDiv.innerHTML = '<span style="color: #dc2626;">Please log in first</span>';
        return;
    }
    
    resultDiv.innerHTML = '<span style="color: #6b7280;">Looking up...</span>';
    
    try {
        const response = await fetch(`${getAPIBase()}/gym-memberships/lookup-primary?email=${encodeURIComponent(email)}`, {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok && data.found) {
            resultDiv.innerHTML = `<span style="color: #059669;">✓ Found: ${data.name || data.email}</span>`;
            formData.household.primaryMemberId = data.memberId;
            formData.household.primaryHouseholdId = data.householdId;
        } else {
            resultDiv.innerHTML = `<span style="color: #dc2626;">✗ ${data.error || 'No active primary member found with this email'}</span>`;
            formData.household.primaryMemberId = null;
            formData.household.primaryHouseholdId = null;
        }
    } catch (error) {
        console.error('Error looking up primary member:', error);
        resultDiv.innerHTML = `<span style="color: #dc2626;">Error looking up member</span>`;
    }
}

// Global functions for button handlers
window.setHouseholdLink = function(value) {
    formData.household.linkToHousehold = value;
    document.getElementById('linkToHousehold').value = value;
    renderStep(currentStep);
};

window.setBillingMode = async function(value) {
    formData.household.billingMode = value;
    document.getElementById('billingMode').value = value;
    const buttons = document.querySelectorAll('[data-value="BILL_TO_PRIMARY"], [data-value="BILL_TO_SELF"]');
    buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === value);
    });
    
    // Validate household ID when user selects "Primary Member Pays" (BILL_TO_PRIMARY)
    if (value === 'BILL_TO_PRIMARY') {
        const householdIdInput = document.getElementById('householdId');
        if (householdIdInput) {
            const householdId = householdIdInput.value.trim();
            if (householdId) {
                await validateHouseholdId(householdId);
            } else {
                // Show error if household ID is required but not entered
                const resultDiv = document.getElementById('householdIdValidationResult');
                if (resultDiv) {
                    resultDiv.innerHTML = '<span style="color: #dc2626;">Please enter a household ID</span>';
                    // Highlight the input field
                    householdIdInput.style.borderColor = '#dc2626';
                    householdIdInput.classList.add('field-error');
                }
            }
        }
    } else {
        // Clear validation result when switching to "I Pay for Myself"
        const resultDiv = document.getElementById('householdIdValidationResult');
        if (resultDiv) {
            resultDiv.innerHTML = '';
        }
        const householdIdInput = document.getElementById('householdId');
        if (householdIdInput) {
            householdIdInput.style.borderColor = '';
            householdIdInput.classList.remove('field-error');
        }
    }
};

window.setGroupJoin = function(value) {
    // Store as string to match render logic
    formData.group.joinGroup = value;
    const hiddenInput = document.getElementById('joinGroup');
    if (hiddenInput) {
        hiddenInput.value = value;
    }
    // Clear group action when switching to 'no'
    if (value === 'no') {
        formData.group.groupAction = '';
        formData.group.groupCode = null;
        formData.group.groupId = null;
    }
    // Re-render the CURRENT step only - don't change step index
    const stepToRender = currentStep;
    renderStep(stepToRender);
};

window.setGroupAction = function(value) {
    formData.group.groupAction = value;
    const hiddenInput = document.getElementById('groupAction');
    if (hiddenInput) {
        hiddenInput.value = value;
    }
    // Clear group code when switching actions
    if (value === 'create') {
        formData.group.groupCode = null;
        formData.group.groupId = null;
    } else if (value === 'join') {
        formData.group.groupId = null;
    }
    // Re-render the CURRENT step only - don't change step index
    const stepToRender = currentStep;
    renderStep(stepToRender);
};

// Toggle waiver checkbox
window.toggleWaiverCheckbox = function() {
    const checkbox = document.getElementById('waiverAccept');
    const checkboxDiv = document.getElementById('waiverCheckbox');
    const checkmark = document.getElementById('waiverCheckmark');
    
    if (!checkbox || !checkboxDiv || !checkmark) return;
    
    checkbox.checked = !checkbox.checked;
    
    if (checkbox.checked) {
        checkboxDiv.style.borderColor = '#047857';
        checkboxDiv.style.background = 'rgba(4, 120, 87, 0.12)';
        checkmark.style.display = 'block';
    } else {
        checkboxDiv.style.borderColor = '#d1d5db';
        checkboxDiv.style.background = '#ffffff';
        checkmark.style.display = 'none';
    }
    
    // Validate signature when checkbox changes
    validateWaiverSignature();
};

// Validate waiver signature matches first and last name
window.validateWaiverSignature = function() {
    const signatureInput = document.getElementById('waiverSignature');
    const errorDiv = document.getElementById('waiverSignatureError');
    const checkbox = document.getElementById('waiverAccept');
    
    if (!signatureInput || !errorDiv) return;
    
    const signature = signatureInput.value.trim();
    const firstName = formData.profile.firstName || '';
    const lastName = formData.profile.lastName || '';
    const expectedName = `${firstName} ${lastName}`.trim();
    
    // Clear previous error
    errorDiv.style.display = 'none';
    signatureInput.style.borderColor = '#e5e7eb';
    
    if (!signature) {
        return; // Don't show error if empty, let required validation handle it
    }
    
    // Normalize both names for comparison (case-insensitive, extra spaces)
    const normalizedSignature = signature.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedExpected = expectedName.toLowerCase().replace(/\s+/g, ' ').trim();
    
    if (normalizedSignature !== normalizedExpected) {
        errorDiv.textContent = `Name must match your first and last name: ${expectedName}`;
        errorDiv.style.display = 'block';
        signatureInput.style.borderColor = '#ef4444';
        return false;
    }
    
    return true;
};

// Toggle waiver expand/collapse
window.toggleWaiver = function() {
    const container = document.getElementById('waiverContainer');
    const toggle = document.getElementById('waiverToggle');
    const fade = document.getElementById('waiverFade');
    
    if (!container || !toggle) return;
    
    // Check if expanded by looking at maxHeight or class
    const isExpanded = container.style.maxHeight === 'none' || 
                       container.style.maxHeight === '' ||
                       container.classList.contains('waiver-expanded');
    
    const toggleText = toggle.querySelector('span');
    const toggleIcon = toggle.querySelector('svg');
    
    if (isExpanded) {
        // Collapse
        container.classList.remove('waiver-expanded');
        container.style.maxHeight = '500px';
        fade.style.display = 'block';
        if (toggleText) toggleText.textContent = 'Show Full Waiver';
        if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
    } else {
        // Expand
        container.classList.add('waiver-expanded');
        container.style.maxHeight = 'none';
        fade.style.display = 'none';
        if (toggleText) toggleText.textContent = 'Show Less';
        if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
    }
};

// Create a new group
// Create group when moving to next step (called from handleNext)
async function createGroupIfNeeded() {
    // Only create if user selected 'create' and hasn't created yet
    if (formData.group.joinGroup === 'yes' && 
        formData.group.groupAction === 'create' && 
        !formData.group.groupId) {
        
        // Get group name - try formData first, then input field
        let groupName = formData.group.groupName;
        if (!groupName || !groupName.trim()) {
            const groupNameInput = document.getElementById('groupName');
            if (groupNameInput && groupNameInput.value) {
                groupName = groupNameInput.value.trim();
            }
        }
        
        if (!groupName || !groupName.trim()) {
            return { error: 'Group name is required' };
        }
        
        // Store it in formData BEFORE making API call
        formData.group.groupName = groupName;
        
        // Get fresh token
        const currentToken = getToken();
        if (!currentToken) {
            return { error: 'Please log in first' };
        }
        
        try {
            const apiBase = getAPIBase();
            const response = await fetch(`${apiBase}/gym-memberships/create-group`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({ groupName })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                // Store the group code, ID, and name - PRESERVE the name the user entered
                formData.group.groupCode = data.groupAccessCode;
                formData.group.groupId = data.groupId;
                // Keep the group name that was entered (don't overwrite if it exists)
                if (!formData.group.groupName || !formData.group.groupName.trim()) {
                    formData.group.groupName = data.groupName || groupName;
                }
                
                console.log('=== GROUP CREATED SUCCESSFULLY ===');
                console.log('Group ID:', formData.group.groupId);
                console.log('Group Name:', formData.group.groupName);
                console.log('Full formData.group:', JSON.stringify(formData.group));
                
                return { success: true };
            } else {
                return { error: data.error || 'Failed to create group' };
            }
        } catch (error) {
            console.error('Error creating group:', error);
            return { error: 'Error creating group. Please try again.' };
        }
    }
    return { success: true };
}

// Handle form submission
async function handleSubmit() {
    console.log('=== HANDLE SUBMIT CALLED ===');
    console.log('Current step:', currentStep);
    console.log('Form data:', formData);
    
    // Disable submit button and show loading state
    const submitButton = document.getElementById('membershipWizardSubmit');
    let originalText = 'Submit';
    if (submitButton) {
        originalText = submitButton.textContent;
        submitButton.disabled = true;
        submitButton.textContent = 'Processing...';
        submitButton.style.opacity = '0.6';
        submitButton.style.cursor = 'not-allowed';
    }
    
    // Helper to re-enable button on error
    const reEnableButton = () => {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
            submitButton.style.opacity = '1';
            submitButton.style.cursor = 'pointer';
        }
    };
    
    // Collect current step data first
    collectCurrentStepData();
    
    // If on billing step, process payment first
    if (currentStep === 7 && formData.paymentIntent?.clientSecret) {
        console.log('Processing payment before creating membership...');
        
        try {
            // Get Stripe instance
            let stripeInstance = null;
            if (typeof window !== 'undefined' && window.stripe) {
                stripeInstance = window.stripe;
            } else if (typeof stripe !== 'undefined' && stripe) {
                stripeInstance = stripe;
            }
            
            if (!stripeInstance || !membershipStripeElements) {
                alert('Payment system not initialized. Please refresh and try again.');
                reEnableButton();
                return;
            }
            
            const { error: submitError } = await membershipStripeElements.submit();
            if (submitError) {
                alert(submitError.message || 'Please complete the payment form.');
                reEnableButton();
                return;
            }
            
            // Confirm payment with Stripe
            const { error: confirmError, paymentIntent: confirmedPaymentIntent } = await stripeInstance.confirmPayment({
                elements: membershipStripeElements,
                confirmParams: {
                    return_url: window.location.href
                },
                redirect: 'if_required'
            });
            
            if (confirmError) {
                console.error('Payment confirmation error:', confirmError);
                alert(`Payment failed: ${confirmError.message}`);
                reEnableButton();
                return;
            }
            
            if (confirmedPaymentIntent.status !== 'succeeded') {
                alert(`Payment not completed. Status: ${confirmedPaymentIntent.status}`);
                reEnableButton();
                return;
            }
            
            console.log('Payment succeeded:', confirmedPaymentIntent.id);
            // Store payment intent ID for later use
            if (formData.paymentIntent) {
                formData.paymentIntent.id = confirmedPaymentIntent.id;
            } else {
                formData.paymentIntent = { id: confirmedPaymentIntent.id };
            }
        } catch (paymentError) {
            console.error('Error processing payment:', paymentError);
            alert(`Payment error: ${paymentError.message || 'Failed to process payment'}`);
            reEnableButton();
            return;
        }
    }
    
    // Validate current step (for billing, just check that payment was processed)
    if (currentStep === 7) {
        // Billing step - payment should already be processed above
        if (!formData.paymentIntent?.clientSecret) {
            alert('Please complete the payment form before submitting.');
            reEnableButton();
            return;
        }
    } else if (!validateCurrentStep()) {
        reEnableButton();
        return;
    }
    
    // Build final payload according to member-creation-schema.json
    const payload = buildMembershipPayload();
    console.log('Payload:', payload);
    
    // Get fresh token
    const currentToken = getToken();
    if (!currentToken) {
        alert('Please log in first');
        reEnableButton();
        return;
    }
    
    try {
        console.log('Sending membership creation request...');
        console.log('API Base:', getAPIBase());
        console.log('Payload keys:', Object.keys(payload));
        console.log('Full payload:', JSON.stringify(payload, null, 2));
        
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        let response;
        try {
            console.log('About to call fetch...');
            response = await fetch(`${getAPIBase()}/gym-memberships/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            console.log('Fetch completed, response received');
        } catch (fetchError) {
            clearTimeout(timeoutId);
            console.error('Fetch error:', fetchError);
            console.error('Fetch error name:', fetchError.name);
            console.error('Fetch error message:', fetchError.message);
            if (fetchError.name === 'AbortError') {
                throw new Error('Request timed out after 30 seconds. Please check your connection and try again.');
            }
            throw new Error('Network error: ' + (fetchError.message || 'Failed to connect to server'));
        }
        
        console.log('Response received, status:', response.status);
        console.log('Response ok:', response.ok);
        console.log('Response statusText:', response.statusText);
        
        let data;
        let text;
        try {
            console.log('Reading response text...');
            text = await response.text();
            console.log('Response text received, length:', text.length);
            console.log('Response text (first 500 chars):', text.substring(0, 500));
            
            if (!text || text.trim() === '') {
                console.error('Empty response from server');
                throw new Error('Empty response from server');
            }
            
            console.log('Parsing JSON...');
            data = JSON.parse(text);
            console.log('Parsed response data:', data);
        } catch (parseError) {
            console.error('Failed to parse response:', parseError);
            console.error('Parse error name:', parseError.name);
            console.error('Parse error message:', parseError.message);
            console.error('Response text that failed to parse:', text);
            throw new Error('Invalid response from server: ' + (parseError.message || 'Could not parse response'));
        }
        
        console.log('Create membership response:', data);
        console.log('Response status:', response.status);
        console.log('Response ok:', response.ok);
        
        if (response.ok) {
            console.log('Membership created successfully!');
            const membershipId = data.membershipId;
            const paymentIntentId = formData.paymentIntent?.id;
            
            // Confirm payment and create Stripe subscription
            if (paymentIntentId && membershipId) {
                try {
                    console.log('Confirming payment and creating subscription...');
                    const confirmResponse = await fetch(`${getAPIBase()}/gym-memberships/confirm-payment`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${currentToken}`
                        },
                        body: JSON.stringify({
                            paymentIntentId: paymentIntentId,
                            membershipId: membershipId,
                            profile: formData.profile,
                            address: formData.address,
                            emergencyContact: formData.emergencyContact || {}
                        })
                    });
                    
                    const confirmData = await confirmResponse.json();
                    
                    if (confirmResponse.ok) {
                        console.log('Payment confirmed and subscription created:', confirmData);
                    } else {
                        console.error('Failed to confirm payment:', confirmData);
                        // Don't fail the whole process - membership is created, payment can be handled later
                        alert('Membership created, but there was an issue setting up recurring billing. Please contact support.');
                    }
                } catch (confirmError) {
                    console.error('Error confirming payment:', confirmError);
                    // Don't fail the whole process - membership is created
                    alert('Membership created, but there was an issue setting up recurring billing. Please contact support.');
                }
            } else {
                console.warn('Missing payment intent ID or membership ID for subscription creation');
            }
            
            // Show success message
            if (typeof window.showSuccess === 'function') {
                window.showSuccess('Membership created successfully! Your gym membership is now active.');
            } else if (typeof showSuccess === 'function') {
                showSuccess('Membership created successfully! Your gym membership is now active.');
            } else {
                alert('Membership created successfully! Your gym membership is now active.');
            }
            
            // Close wizard
            closeWizard();
            
            // Wait a moment for the wizard to close
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Reload gym membership details and show the section
            if (typeof window.loadGymMembershipDetails === 'function') {
                console.log('Calling loadGymMembershipDetails...');
                await window.loadGymMembershipDetails();
            } else if (typeof loadGymMembershipDetails === 'function') {
                console.log('Calling loadGymMembershipDetails (local)...');
                await loadGymMembershipDetails();
            }
            
            // Show the gym membership section
            if (typeof window.showSubscriptionInfo === 'function') {
                console.log('Calling showSubscriptionInfo...');
                window.showSubscriptionInfo();
            } else if (typeof showSubscriptionInfo === 'function') {
                console.log('Calling showSubscriptionInfo (local)...');
                showSubscriptionInfo();
            } else {
                // Fallback: try to show the gym membership card
                console.log('Trying to scroll to gym membership card...');
                const gymMembershipCard = document.querySelector('.gym-membership-card');
                if (gymMembershipCard) {
                    gymMembershipCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        } else {
            console.error('Membership creation failed:', data);
            const errorMessage = data.error || data.message || 'Failed to create membership';
            alert(`Error: ${errorMessage}`);
            reEnableButton();
        }
    } catch (error) {
        console.error('Error creating membership:', error);
        console.error('Error stack:', error.stack);
        alert(`An error occurred while creating your membership: ${error.message || 'Please try again.'}`);
        reEnableButton();
    }
}

// Build membership payload according to member-creation-schema.json
function buildMembershipPayload() {
    const now = new Date().toISOString();
    const today = new Date().toISOString().split('T')[0];
    
    // Calculate contract end date (12 months from today)
    const contractStart = new Date(today);
    const contractEnd = new Date(contractStart);
    contractEnd.setMonth(contractEnd.getMonth() + 12);
    const contractEndDate = contractEnd.toISOString().split('T')[0];
    
    const membershipType = formData.membership.membershipType;

    const baseMonthlyDollarsByType = {
        STANDARD: 65,
        IMMEDIATE_FAMILY: 50,
        EXPECTING_RECOVERING: 30,
        FULL_FAMILY: 185
    };
    const monthlyListDollars = baseMonthlyDollarsByType[membershipType] ?? 65;
    const earlyCancellationFeeDollars = Math.max(100, 2 * monthlyListDollars);
    
    // Get current user ID
    const currentUserId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) 
        ? currentUser.id 
        : null;
    
    if (!currentUserId) {
        throw new Error('User not authenticated');
    }
    
    // Build household object based on membership type and selections
    let household = {};
    let householdId = null;
    
    if (membershipType === 'FULL_FAMILY') {
        // FULL_FAMILY: Always PRIMARY
        household = {
            householdRole: 'PRIMARY',
            primaryMemberId: null,
            billingOwnerMemberId: currentUserId, // Will be set server-side
            billingMode: null
        };
        // householdId will be generated server-side
    } else if (membershipType === 'STANDARD') {
        if (formData.household.linkToHousehold === 'no') {
            // STANDARD: PRIMARY
            household = {
                householdRole: 'PRIMARY',
                primaryMemberId: null,
                billingOwnerMemberId: currentUserId,
                billingMode: null
            };
            // householdId will be generated server-side
        } else {
            // STANDARD: DEPENDENT (must be BILL_TO_PRIMARY)
            household = {
                householdRole: 'DEPENDENT',
                primaryMemberId: formData.household.primaryMemberId,
                billingOwnerMemberId: formData.household.primaryMemberId,
                billingMode: 'BILL_TO_PRIMARY',
                householdId: formData.household.primaryHouseholdId
            };
        }
    } else {
        // IMMEDIATE_FAMILY or EXPECTING_RECOVERING
        if (formData.household.linkToHousehold === 'no') {
            // INDEPENDENT
            household = {
                householdRole: 'INDEPENDENT',
                primaryMemberId: null,
                billingOwnerMemberId: currentUserId,
                billingMode: null
            };
        } else {
            // Can be DEPENDENT or INDEPENDENT based on billing mode
            // Use householdId for IMMEDIATE_FAMILY/EXPECTING_RECOVERING (not email lookup)
            const providedHouseholdId = formData.household.householdId?.toUpperCase().trim() || '';
            
            if (formData.household.billingMode === 'BILL_TO_PRIMARY') {
                // DEPENDENT - primary member pays
                household = {
                    householdRole: 'DEPENDENT',
                    primaryMemberId: null, // Will be resolved server-side from householdId
                    billingOwnerMemberId: null, // Will be resolved server-side
                    billingMode: 'BILL_TO_PRIMARY',
                    householdId: providedHouseholdId
                };
                householdId = providedHouseholdId;
            } else {
                // INDEPENDENT (linked but self-pay)
                household = {
                    householdRole: 'INDEPENDENT',
                    primaryMemberId: null, // Will be resolved server-side from householdId
                    billingOwnerMemberId: currentUserId,
                    billingMode: 'BILL_TO_SELF',
                    householdId: providedHouseholdId
                };
                householdId = providedHouseholdId;
            }
        }
    }
    
    const payload = {
        profile: {
            firstName: formData.profile.firstName,
            lastName: formData.profile.lastName,
            dateOfBirth: formData.profile.dateOfBirth,
            gender: formData.profile.gender,
            email: formData.profile.email,
            phone: formData.profile.phone
        },
        address: {
            street: formData.address.street,
            city: formData.address.city,
            state: formData.address.state,
            zip: formData.address.zip
        },
        membership: {
            membershipType: membershipType,
            status: 'ACTIVE',
            membershipStartDate: today
        },
        contract: {
            contractStartDate: today,
            contractEndDate: contractEndDate,
            contractLengthMonths: 12,
            earlyCancellationFeeDollars,
            earlyCancellationFeePolicy: 'two_months_of_monthly_rate_minimum_100',
            pauseUsed: false
        },
        household: household,
        group: {
            joinGroup: formData.group.joinGroup || false,
            groupCode: formData.group.groupCode || null
        },
        emergencyContact: formData.emergencyContact,
        acknowledgements: formData.acknowledgements,
        billing: {
            billingEmail: formData.billing.billingEmail
        }
    };
    
    // Add expecting/recovering data if applicable
    if (membershipType === 'EXPECTING_RECOVERING' && formData.expectingRecovering) {
        payload.expectingRecovering = formData.expectingRecovering;
    }
    
    // Add family data if FULL_FAMILY
    if (membershipType === 'FULL_FAMILY' && formData.family) {
        payload.family = formData.family;
    }
    
    return payload;
}

// Validate all previous steps before showing billing
function validateAllPreviousSteps() {
    // Collect data from current step first
    collectCurrentStepData();
    
    // Validate data exists in formData (don't require DOM elements)
    // Profile validation
    if (!formData.profile?.firstName || !formData.profile?.lastName ||
        !formData.profile?.phone ||
        !formData.profile?.gender || !formData.profile?.email) {
        console.log('Profile validation failed:', formData.profile);
        return false;
    }
    
    // Address validation
    if (!formData.address?.street || !formData.address?.city || 
        !formData.address?.state || !formData.address?.zip) {
        console.log('Address validation failed:', formData.address);
        return false;
    }
    
    // Membership type validation
    if (!formData.membership?.membershipType) {
        console.log('Membership type validation failed:', formData.membership);
        return false;
    }
    
    // Household validation (can be optional depending on membership type)
    // Skip for now - household step might be optional
    
    // Group validation (optional - can skip)
    
    // Emergency contact (optional - can skip)
    
    // Disclosures validation
    if (!formData.acknowledgements?.membershipContractTermsAcceptedAt ||
        !formData.acknowledgements?.waiverAcceptedAt || !formData.acknowledgements?.waiverSignature) {
        console.log('Disclosures validation failed:', formData.acknowledgements);
        return false;
    }
    
    return true;
}

// Initialize Stripe payment element
let membershipStripeElements = null;
async function initializeStripePaymentElement() {
    console.log('=== INITIALIZING STRIPE PAYMENT ELEMENT ===');
    const paymentElementContainer = document.getElementById('membershipPaymentElement');
    if (!paymentElementContainer) {
        console.error('Payment element container not found');
        return;
    }
    
    // Wait for Stripe to be available (it's initialized in app.js)
    let stripeInstance = null;
    let attempts = 0;
    const maxAttempts = 20;
    
    while (!stripeInstance && attempts < maxAttempts) {
        // Check if Stripe is available on window (app.js should expose it)
        if (typeof window !== 'undefined' && window.stripe) {
            stripeInstance = window.stripe;
            break;
        }
        // Wait 100ms before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    if (!stripeInstance) {
        console.error('Stripe not found after', maxAttempts, 'attempts');
        paymentElementContainer.innerHTML = '<p style="color: #dc2626;">Error: Payment system not available. Please refresh the page.</p>';
        return;
    }
    
    const membershipType = formData.membership?.membershipType || 'STANDARD';
    // Reuse existing payment intent if we already have one for the same membership type (avoids creating a second PI when user goes back then forward on billing step)
    if (formData.paymentIntent?.clientSecret && formData.paymentIntent.membershipType === membershipType) {
        console.log('Reusing existing payment intent for membership type:', membershipType);
        paymentElementContainer.innerHTML = '';
        try {
            membershipStripeElements = stripeInstance.elements({
                clientSecret: formData.paymentIntent.clientSecret,
                appearance: { theme: 'stripe' }
            });
            const paymentElement = membershipStripeElements.create('payment');
            paymentElement.mount('#membershipPaymentElement');
            return;
        } catch (reuseErr) {
            console.warn('Reuse of existing payment intent failed, creating new one:', reuseErr);
            formData.paymentIntent = null;
        }
    }
    
    console.log('Stripe instance found, creating payment intent...');
    paymentElementContainer.innerHTML = '<p style="color: #6b7280;">Loading payment form...</p>';
    
    try {
        // Get fresh token
        const currentToken = getToken();
        if (!currentToken) {
            paymentElementContainer.innerHTML = '<p style="color: #dc2626;">Please log in first</p>';
            return;
        }
        
        // Calculate membership price
        const amount = calculateMembershipPrice(membershipType);
        console.log('Creating payment intent for:', membershipType, 'amount:', amount);
        
        // Create payment intent
        const response = await fetch(`${getAPIBase()}/gym-memberships/create-payment-intent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                amount: amount,
                currency: 'usd',
                membershipType: membershipType
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create payment intent');
        }
        
        const data = await response.json();
        console.log('Payment intent created:', data);
        
        if (!data.clientSecret) {
            throw new Error('No client secret returned');
        }
        
        // Create Stripe Elements instance
        membershipStripeElements = stripeInstance.elements({
            clientSecret: data.clientSecret,
            appearance: {
                theme: 'stripe'
            }
        });
        
        // Create and mount payment element
        const paymentElement = membershipStripeElements.create('payment');
        paymentElement.mount('#membershipPaymentElement');
        console.log('Payment element mounted successfully');
        
        // Store payment intent info for later use (membershipType so we reuse same PI when re-entering billing step)
        formData.paymentIntent = {
            clientSecret: data.clientSecret,
            id: data.paymentIntentId || null,
            membershipType: membershipType
        };
        
    } catch (error) {
        console.error('Error initializing Stripe payment element:', error);
        paymentElementContainer.innerHTML = `<p style="color: #dc2626;">Error: ${error.message || 'Failed to load payment form. Please try again.'}</p>`;
    }
}

// Calculate membership price (in cents)
function calculateMembershipPrice(membershipType) {
    // Pricing aligned with membership-rules.json and routes.js
    const pricing = {
        'STANDARD': 6500,              // $65.00/month
        'IMMEDIATE_FAMILY': 5000,      // $50.00/month
        'EXPECTING_RECOVERING': 3000,  // $30.00/month
        'FULL_FAMILY': 18500           // $185.00/month
    };
    
    return pricing[membershipType] || 6500;
}

// Close wizard
function closeWizard() {
    const wizardContainer = document.getElementById('membershipSignupWizard');
    if (wizardContainer) {
        wizardContainer.style.display = 'none';
        // Reset event listeners flag so they can be set up again when wizard reopens
        eventListenersSetup = false;
        
        // Clean up Stripe Elements
        if (membershipStripeElements) {
            const paymentElementContainer = document.getElementById('membershipPaymentElement');
            if (paymentElementContainer) {
                paymentElementContainer.innerHTML = '';
            }
            membershipStripeElements = null;
        }
    }
}

// openMembershipSignupWizard is already defined earlier in the file (line 87)

// Format date of birth field as user types - auto-advance after year
function formatDateOfBirth(input) {
    let value = input.value.replace(/\D/g, ''); // Remove non-digits
    
    // Limit to 8 digits (MMDDYYYY)
    if (value.length > 8) {
        value = value.slice(0, 8);
    }
    
    // Format as MM/DD/YYYY with auto-advance
    let formatted = '';
    if (value.length > 0) {
        // Month (2 digits)
        formatted = value.slice(0, 2);
        if (value.length >= 2) {
            // Validate month (01-12)
            const month = parseInt(value.slice(0, 2));
            if (month > 12) {
                formatted = '12';
                value = '12' + value.slice(2);
            }
            if (month === 0) {
                formatted = '01';
                value = '01' + value.slice(2);
            }
        }
        
        if (value.length > 2) {
            formatted += '/' + value.slice(2, 4);
            // Validate day (01-31)
            if (value.length >= 4) {
                const day = parseInt(value.slice(2, 4));
                if (day > 31) {
                    formatted = formatted.slice(0, 3) + '31';
                    value = value.slice(0, 2) + '31' + value.slice(4);
                }
                if (day === 0) {
                    formatted = formatted.slice(0, 3) + '01';
                    value = value.slice(0, 2) + '01' + value.slice(4);
                }
            }
        }
        
        if (value.length > 4) {
            // Year - limit to 4 digits, auto-advance after 4th digit
            const year = value.slice(4, 8);
            if (year.length <= 4) {
                formatted += '/' + year;
            } else {
                formatted += '/' + year.slice(0, 4);
            }
        }
    }
    
    input.value = formatted;
}

// Format phone number as user types: (555) 123-4567
function formatPhoneNumber(input) {
    let value = input.value.replace(/\D/g, ''); // Remove non-digits
    
    // Limit to 10 digits
    if (value.length > 10) {
        value = value.slice(0, 10);
    }
    
    // Format based on length
    let formatted = '';
    if (value.length > 0) {
        formatted = '(' + value.slice(0, 3);
        if (value.length > 3) {
            formatted += ') ' + value.slice(3, 6);
        }
        if (value.length > 6) {
            formatted += '-' + value.slice(6, 10);
        }
    }
    
    input.value = formatted;
}

// Format date for display (convert YYYY-MM-DD to MM/DD/YYYY)
function formatDateForDisplay(dateValue) {
    if (!dateValue) return '';
    
    // If already in MM/DD/YYYY format, return as is
    if (dateValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        return dateValue;
    }
    
    // If in YYYY-MM-DD format, convert to MM/DD/YYYY
    if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const parts = dateValue.split('-');
        return `${parts[1]}/${parts[2]}/${parts[0]}`;
    }
    
    return dateValue;
}

// Format phone for display (convert digits to (555) 123-4567)
function formatPhoneForDisplay(phoneValue) {
    if (!phoneValue) return '';
    
    // If already formatted, return as is
    if (phoneValue.match(/^\(\d{3}\) \d{3}-\d{4}$/)) {
        return phoneValue;
    }
    
    // If just digits, format it
    const digits = phoneValue.replace(/\D/g, '');
    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }
    
    return phoneValue;
}

// Make functions globally available immediately (before DOM ready)
if (typeof window !== 'undefined') {
    window.openMembershipSignupWizard = openMembershipSignupWizard;
    window.initMembershipSignupWizard = initMembershipSignupWizard;
}

// Also ensure it's set when DOM is ready (in case script loads before DOM)
if (typeof document !== 'undefined') {
    const setGlobalFunctions = () => {
        window.openMembershipSignupWizard = openMembershipSignupWizard;
        window.initMembershipSignupWizard = initMembershipSignupWizard;
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setGlobalFunctions);
    } else {
        // DOM already loaded, set it now
        setGlobalFunctions();
    }
}

