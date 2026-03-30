// Macro Calculator functionality
let macroCalculatorState = {
    dailyCalories: 0,
    proteinGrams: 0,
    fatGrams: 0,
    carbsGrams: 0,
    proteinPercent: 0,
    fatPercent: 0,
    carbsPercent: 0
};

// Store saved meal plan data for restoration
let savedMealPlanData = null;
let savedNumberOfMeals = null;

// Initialize macro calculator
function initMacroCalculator() {
    const macroContent = document.getElementById('macroContent');
    if (!macroContent) {
        console.error('macroContent element not found');
        return;
    }
    
    // Check if already initialized (look for the calculator container)
    const existingContainer = macroContent.querySelector('.macro-calculator-container');
    if (existingContainer) {
        console.log('Macro calculator already initialized');
        // Reload plan to ensure finished section is shown if plan exists
        loadMacroPlan();
        return;
    }
    
    console.log('Initializing macro calculator...');
    macroContent.innerHTML = getMacroCalculatorHTML();
    
    // Setup event listeners
    setupMacroCalculatorListeners();
    
    // Initialize page state
    initializeMacroPage();
    
    console.log('Macro calculator initialized');
}

// Get macro calculator HTML
function getMacroCalculatorHTML() {
    return `
        <div class="macro-calculator-container">
            <div class="macro-title-section">
                <h2>Custom Meal Plan Macro Calculator</h2>
            </div>

            <form id="macroCalcForm" class="macro-calc-form">
                <div class="macro-form-row">
                    <div class="macro-form-group">
                        <label for="macroAge">Age</label>
                        <input type="number" id="macroAge" name="age" placeholder="years" required>
                    </div>
                    <div class="macro-form-group">
                        <label for="macroGender">Gender</label>
                        <select id="macroGender" name="gender" required>
                            <option value="female" selected>Female</option>
                            <option value="male">Male</option>
                        </select>
                    </div>
                </div>

                <div class="macro-form-row">
                    <div class="macro-form-group">
                        <label for="macroHeight">Height (inches)</label>
                        <input type="number" id="macroHeight" name="height" placeholder="inches" required>
                    </div>
                    <div class="macro-form-group">
                        <label for="macroWeight">Weight (lbs)</label>
                        <input type="number" id="macroWeight" name="weight" placeholder="lbs" required>
                    </div>
                </div>

                <div class="macro-button-group">
                    <button type="button" id="macroFormGoButton" class="btn btn-primary">Go</button>
                </div>

                <div id="macroTotalsMessage" class="macro-error-message" style="display: none;">
                    <p>The total percentage for each macro must equal 100% before submitting.</p>
                </div>
            </form>

            <!-- Body Fat Section -->
            <div id="macroBodyFatSection" class="macro-body-fat-section" style="display: none;">
                <h2 style="text-align: center;">Body Fat Percentage</h2>
                
                <div class="macro-meal-plan-instructions macro-body-fat-info-collapsible">
                    <div class="macro-body-fat-info-header" id="macroBodyFatInfoHeader">
                        <p>Enter your estimated body fat percentage. This is used to calculate your Resting Metabolic Rate (RMR) using the Katch-McArdle formula.</p>
                        <button type="button" class="macro-expand-btn" id="macroExpandBodyFatInfoBtn" aria-label="Expand info">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="macro-body-fat-info-content" id="macroBodyFatInfoContent" style="display: none;">
                        <p>Take a moment to honestly assess your current body fat percentage and use the reference table below as a guide to estimate where you might currently fall. It's important to be as accurate as possible to get the best results from the macro calculator.</p>
                        <table class="macro-help-table">
                            <tr>
                                <th>Category</th>
                                <th>Men</th>
                                <th>Women</th>
                            </tr>
                            <tr>
                                <td>Essential</td>
                                <td>2%-5%</td>
                                <td>10%-13%</td>
                            </tr>
                            <tr>
                                <td>Athletic</td>
                                <td>6%-13%</td>
                                <td>14%-20%</td>
                            </tr>
                            <tr>
                                <td>Fit</td>
                                <td>14%-17%</td>
                                <td>21%-24%</td>
                            </tr>
                            <tr>
                                <td>Average</td>
                                <td>18%-24%</td>
                                <td>25%-31%</td>
                            </tr>
                            <tr>
                                <td>Below Average</td>
                                <td>25%+</td>
                                <td>32%+</td>
                            </tr>
                        </table>
                        <p><strong>Athletic:</strong> This body fat level is typically found in athletes and is associated with increased muscle definition and visible abs. For men, it falls between 6%-13% and for women, it falls between 14%-20%.</p>
                        <p><strong>Fit:</strong> This body fat level is associated with a healthy and active lifestyle and is achievable through regular exercise and balanced nutrition. For men, it falls between 14%-17% and for women, it falls between 21%-24%.</p>
                        <p><strong>Average:</strong> This body fat level is the average for most people and is generally considered healthy. For men, it falls between 18%-24% and for women, it falls between 25%-31%.</p>
                        <p><strong>Below Average:</strong> This body fat level is higher than average and may increase the risk of certain health conditions. For men, it is 25% or higher and for women, it is 32% or higher.</p>
                        <p>*This is a very broad guideline. Getting a Dexa scan would be most accurate.</p>
                    </div>
                </div>
                
                <div class="macro-form-row">
                    <div class="macro-form-group macro-form-group-full">
                        <label for="macroBodyfat">Body Fat Percentage</label>
                        <div class="macro-input-with-percent">
                            <input type="number" id="macroBodyfat" name="bodyfat" placeholder="0" required>
                            <span class="macro-percent-suffix">%</span>
                        </div>
                    </div>
                </div>
                
                <div class="macro-button-group" style="display: flex !important; flex-direction: column !important; gap: 0.75rem; align-items: center;">
                    <button type="button" id="macroBodyFatGoButton" class="btn btn-primary" style="width: 100%; max-width: 200px;">Go</button>
                    <button type="button" id="macroBodyFatBackButton" class="btn btn-secondary" style="width: 100%; max-width: 200px;">Back</button>
                </div>
            </div>

            <!-- Set Your Macros Section -->
            <div id="macroSetMacrosSection" class="macro-set-macros-section" style="display: none;">
                <h2 style="text-align: center;">Set Your Macros</h2>
                
                <div class="macro-meal-plan-instructions macro-macros-info-collapsible">
                    <div class="macro-macros-info-header" id="macroMacrosInfoHeader">
                        <p>Enter the percentage breakdown for your macronutrients. The total for Protein, Fat, and Carbs must equal 100%.</p>
                        <button type="button" class="macro-expand-btn" id="macroExpandMacrosInfoBtn" aria-label="Expand info">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="macro-macros-info-content" id="macroMacrosInfoContent" style="display: none;">
                        <p>Choose your macro ratios based on your goals:</p>
                        <table class="macro-help-table">
                            <tr>
                                <th>Macro Type</th>
                                <th>Carbs</th>
                                <th>Protein</th>
                                <th>Fat</th>
                            </tr>
                            <tr>
                                <td>High Carb (Body Building)</td>
                                <td>40%-60%</td>
                                <td>25%-35%</td>
                                <td>15%-25%</td>
                            </tr>
                            <tr>
                                <td>Moderate Carb (for Maintenance)</td>
                                <td>30%-50%</td>
                                <td>25%-35%</td>
                                <td>25%-35%</td>
                            </tr>
                            <tr>
                                <td>Low Carb (for Fat Loss)</td>
                                <td>10%-30%</td>
                                <td>40%-50%</td>
                                <td>30%-40%</td>
                            </tr>
                        </table>
                    </div>
                </div>
                
                <div class="macro-form-row">
                    <div class="macro-form-group">
                        <label for="macroProtein">Protein</label>
                        <div class="macro-input-with-percent">
                            <input type="number" id="macroProtein" name="protein" placeholder="0" required>
                            <span class="macro-percent-suffix">%</span>
                        </div>
                    </div>
                    <div class="macro-form-group">
                        <label for="macroFat">Fat</label>
                        <div class="macro-input-with-percent">
                            <input type="number" id="macroFat" name="fat" placeholder="0" required>
                            <span class="macro-percent-suffix">%</span>
                        </div>
                    </div>
                    <div class="macro-form-group">
                        <label for="macroCarbs">Carbs</label>
                        <div class="macro-input-with-percent">
                            <input type="number" id="macroCarbs" name="carbs" placeholder="0" required>
                            <span class="macro-percent-suffix">%</span>
                        </div>
                    </div>
                </div>
                
                <div id="macroTotalsMessage" class="macro-error-message" style="display: none;">
                    <p>The total percentage for each macro must equal 100% before submitting.</p>
                </div>
                
                <div class="macro-button-group">
                    <button type="button" id="macroMacrosBackButton" class="btn btn-secondary">Back</button>
                    <button type="button" id="macroMacrosGoButton" class="btn btn-primary">Go</button>
                </div>
            </div>

            <!-- Activity Factor Section -->
            <div id="macroActivityFactorSection" class="macro-activity-factor-section" style="display: none;">
                <h2 style="text-align: center;">Select Your Activity Level</h2>
                
                <div class="macro-meal-plan-instructions macro-activity-info-collapsible">
                    <div class="macro-activity-info-header" id="macroActivityInfoHeader">
                        <p><strong>Why Activity Level Matters:</strong> Your activity level directly impacts your daily calorie needs. The more active you are, the more calories your body burns throughout the day.</p>
                        <button type="button" class="macro-expand-btn" id="macroExpandActivityInfoBtn" aria-label="Expand info">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="macro-activity-info-content" id="macroActivityInfoContent" style="display: none;">
                        <p><strong>How it works:</strong> Your Resting Metabolic Rate (RMR) is the number of calories your body burns at rest. We then multiply this by an activity factor that accounts for your daily movement and exercise. This gives us your TDEE - the foundation for your macro calculations.</p>
                        
                        <p><strong>Choosing the right level:</strong> Be honest about your activity level. Overestimating can lead to consuming more calories than you need, while underestimating might leave you feeling low on energy. Consider both your structured exercise (workouts, classes) and your daily movement (walking, standing, general activity).</p>
                    </div>
                </div>
                
                <div class="macro-form-row">
                    <div class="macro-form-group macro-form-group-full">
                        <label for="macroActivityFactor">Activity Level</label>
                        <select name="activity-factor-input" id="macroActivityFactor" required>
                            <option value="1.1">I want to be in a calorie deficit (RMR+10%)</option>
                            <option value="1.2" selected>Not working out today</option>
                            <option value="1.3">Light 20-30 min exercise</option>
                            <option value="1.4">Stoic Fitness Class (Taking it Easy)</option>
                            <option value="1.5">Stoic Fitness Class (Max Effort)</option>
                            <option value="1.575">Intense 45-60 min exercise and active all day</option>
                            <option value="1.625">Intense 60 min+ exercise and very active all day</option>
                        </select>
                    </div>
                </div>
                
                <div class="macro-button-group" style="display: flex !important; flex-direction: column !important; gap: 0.75rem; align-items: center;">
                    <button type="button" id="macroActivityFactorGoButton" class="btn btn-primary" style="width: 100%; max-width: 200px;">Go</button>
                    <button type="button" id="macroActivityFactorBackButton" class="btn btn-secondary" style="width: 100%; max-width: 200px;">Back</button>
                </div>
            </div>

            <!-- Results Section -->
            <div id="macroResultsSection" class="macro-results-section" style="display: none;">
                <h2 id="macroDailyCalcHeader" style="text-align: center;">Total Daily Calories</h2>
                <h1 id="macroResultCalories" class="macro-result-calories" style="text-align: center;"></h1>
                
                <div class="macro-meal-plan-instructions macro-results-info-collapsible">
                    <div class="macro-results-info-header" id="macroResultsInfoHeader">
                        <div id="macroResultsInputsDisplay" class="macro-results-inputs-display"></div>
                        <button type="button" class="macro-expand-btn" id="macroExpandResultsInfoBtn" aria-label="Expand info">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="macro-results-info-content" id="macroResultsInfoContent" style="display: none;">
                        <p>Below are your calculated daily calorie needs and macronutrient breakdown based on your inputs. Review the totals, then click "Go" to distribute these macros across your preferred number of meals.</p>
                        <p>These calculations are based on the Katch-McArdle formula, which uses your body composition to determine your Resting Metabolic Rate (RMR). Your Total Daily Energy Expenditure (TDEE) is then calculated by multiplying your RMR by your selected activity factor.</p>
                    </div>
                </div>

                <div class="macro-results-table-container">
                    <table class="macro-results-table">
                        <thead>
                            <tr>
                                <th>Macros</th>
                                <th>Percent</th>
                                <th>Grams</th>
                                <th>Calories</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Protein</td>
                                <td id="macroProteinOverallPercent"></td>
                                <td id="macroProteinInGrams"></td>
                                <td id="macroProteinInCalories"></td>
                            </tr>
                            <tr>
                                <td>Fat</td>
                                <td id="macroFatOverallPercent"></td>
                                <td id="macroFatInGrams"></td>
                                <td id="macroFatInCalories"></td>
                            </tr>
                            <tr>
                                <td>Carbs</td>
                                <td id="macroCarbsOverallPercent"></td>
                                <td id="macroCarbsInGrams"></td>
                                <td id="macroCarbsInCalories"></td>
                            </tr>
                            <tr class="macro-results-total-row">
                                <td><strong>Total</strong></td>
                                <td><strong id="macroTotalPercent">100%</strong></td>
                                <td><strong id="macroTotalGrams"></strong></td>
                                <td><strong id="macroTotalCalories"></strong></td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="macro-button-group">
                    <button type="button" id="macroBackButton" class="btn btn-secondary">Back</button>
                    <button type="button" id="macroCreateMealPlanButton" class="btn btn-primary">Go</button>
                </div>
            </div>

            <!-- Meal Plan Section -->
            <div id="macroMealPlanSection" class="macro-meal-plan-section" style="display: none;">
                <h2 style="text-align: center;">How Many Meals in Day</h2>
                
                <div class="macro-meal-plan-instructions macro-meal-plan-info-collapsible">
                    <div class="macro-meal-plan-info-header" id="macroMealPlanInfoHeader">
                        <p><strong>Meal Planning:</strong> Enter the number of meals you typically eat per day. This allows you to distribute your daily macros across your meals based on your eating schedule.</p>
                        <button type="button" class="macro-expand-btn" id="macroExpandMealPlanInfoBtn" aria-label="Expand info">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="macro-meal-plan-info-content" id="macroMealPlanInfoContent" style="display: none;">
                        <p>For example, if you eat 5 meals, you might have: Breakfast, Snack, Lunch, Snack, Dinner. Choose the number that best fits your daily eating pattern. You can always adjust this later if your schedule changes.</p>
                    </div>
                </div>
                
                <div class="macro-form-row">
                    <div class="macro-form-group macro-form-group-full">
                        <label for="macroMeals">Number of Meals</label>
                        <input type="number" id="macroMeals" name="meals" placeholder="Number of Meals" required max="10">
                    </div>
                </div>
                <div class="macro-button-group" style="display: flex !important; flex-direction: column !important; gap: 0.75rem; align-items: center;">
                    <button type="button" id="macroMealPlanButton" class="btn btn-primary" style="width: 100%; max-width: 200px;">Go</button>
                    <button type="button" id="macroMealPlanSectionBackButton" class="btn btn-secondary" style="width: 100%; max-width: 200px;">Back</button>
                </div>
            </div>

            <!-- Meal Plan Display -->
            <div id="macroMealPlanDisplay" class="macro-meal-plan-display" style="display: none;">
                <h2 style="text-align: center;">Meal Plan</h2>
                <h3 id="macroDateDisplay" style="text-align: center;"></h3>
                <h3 id="macroCalDisplay" style="text-align: center;"></h3>
                
                <div class="macro-meal-plan-instructions macro-meal-plan-display-info-collapsible">
                    <div class="macro-meal-plan-display-info-header" id="macroMealPlanDisplayInfoHeader">
                        <p><strong>Instructions:</strong> Distribute 100% of each macro (Protein, Fat, Carbs) across your meals. Enter the percentage for each macro in each meal. The total for each macro column must equal 100%.</p>
                        <button type="button" class="macro-expand-btn" id="macroExpandMealPlanDisplayInfoBtn" aria-label="Expand info">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="macro-meal-plan-display-info-content" id="macroMealPlanDisplayInfoContent" style="display: none;">
                        <p><strong>Tip:</strong> If you want to front-load your protein because you workout hard, you can allocate more protein to your earlier meals and taper down throughout the day. This strategy can help with muscle recovery and satiety.</p>
                    </div>
                </div>

                <table id="macroMealsTable" class="macro-meals-table">
                    <thead>
                        <tr>
                            <th>Meal</th>
                            <th id="macroProtDisplay"></th>
                            <th id="macroFatDisplay"></th>
                            <th id="macroCarbsDisplay"></th>
                        </tr>
                    </thead>
                    <tbody id="macroMealsTableBody">
                    </tbody>
                </table>

                <div id="macroMealPlanTotalsMessage" class="macro-error-message" style="display: none;">
                    <p>The total percentage for each macro must equal 100% before proceeding.</p>
                </div>

                <div class="macro-button-group" id="macroMealPlanButtons">
                    <button type="button" id="macroMealPlanDisplayBackButton" class="btn btn-secondary">Back</button>
                    <button type="button" id="macroFinishedButton" class="btn btn-primary">Go</button>
                </div>
            </div>
            
            <!-- Finished Section (separate from meal plan display) -->
            <div id="macroFinished" class="macro-finished-message" style="display: none;">
                <div class="macro-saved-success">
                    <h3>✓ Macro Plan Saved</h3>
                    <p>Your macro plan has been saved. You can update it anytime, and your changes will automatically replace your previous plan. Track your progress for at least two weeks, then adjust your calories and macros based on your results. <em>Note: Only one plan can be saved at this time. Multiple plan support coming soon.</em></p>
                </div>
                
                <div class="macro-chatgpt-tip-collapsible">
                    <div class="macro-chatgpt-tip-header" id="macroChatGPTTipHeader">
                        <h4>💡 Pro Tip</h4>
                        <button type="button" class="macro-expand-btn" id="macroExpandTipBtn" aria-label="Expand tip">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                    <div class="macro-chatgpt-tip-content" id="macroChatGPTTipContent" style="display: none;">
                        <p>Copy your meal macros above and paste them into ChatGPT. Ask it to create meal ideas that meet those exact macros, or tell it what you want to eat and ask how much you can have to stay within your macro targets. This makes meal planning quick and personalized!</p>
                    </div>
                </div>
                
                <div class="macro-plan-display-text" id="macroPlanDisplayText">
                    <!-- Meal plan will be displayed here in copyable format -->
                </div>
                
                <div class="macro-button-group">
                    <button type="button" id="macroFinishedSectionBackButton" class="btn btn-secondary">Back</button>
                </div>
            </div>
        </div>
    `;
}

// Setup macro calculator event listeners
function setupMacroCalculatorListeners() {
    // Help buttons (legacy - kept for compatibility)
    const macroHelpButton = document.getElementById('macroHelpButton');
    if (macroHelpButton) {
        macroHelpButton.addEventListener('click', () => toggleElementDisplay('macroTip'));
    }

    // Go button on form (goes to Body Fat screen)
    const formGoButton = document.getElementById('macroFormGoButton');
    if (formGoButton) {
        formGoButton.addEventListener('click', () => {
            // Validate form first
            const form = document.getElementById('macroCalcForm');
            if (form && !form.checkValidity()) {
                form.reportValidity();
                return;
            }
            
            // Hide form, show body fat section
            document.getElementById('macroCalcForm').style.display = 'none';
            document.getElementById('macroBodyFatSection').style.display = 'block';
        });
    }
    
    // Go button on body fat screen (goes to Set Your Macros screen)
    const bodyFatGoButton = document.getElementById('macroBodyFatGoButton');
    if (bodyFatGoButton) {
        bodyFatGoButton.addEventListener('click', () => {
            // Validate body fat input
            const bodyFatInput = document.getElementById('macroBodyfat');
            if (bodyFatInput && !bodyFatInput.checkValidity()) {
                bodyFatInput.reportValidity();
                return;
            }
            
            // Hide body fat section, show macro section
            document.getElementById('macroBodyFatSection').style.display = 'none';
            document.getElementById('macroSetMacrosSection').style.display = 'block';
        });
    }
    
    // Back button on body fat screen (goes back to form)
    const bodyFatBackButton = document.getElementById('macroBodyFatBackButton');
    if (bodyFatBackButton) {
        bodyFatBackButton.addEventListener('click', () => {
            document.getElementById('macroBodyFatSection').style.display = 'none';
            document.getElementById('macroCalcForm').style.display = 'block';
        });
    }
    
    // Go button on macro screen (goes to Activity Factor screen)
    const macrosGoButton = document.getElementById('macroMacrosGoButton');
    if (macrosGoButton) {
        macrosGoButton.addEventListener('click', () => {
            // Check macro percentages
            const protein = parseFloat(document.getElementById('macroProtein')?.value) || 0;
            const fat = parseFloat(document.getElementById('macroFat')?.value) || 0;
            const carbs = parseFloat(document.getElementById('macroCarbs')?.value) || 0;
            const total = protein + fat + carbs;
            
            if (Math.abs(total - 100) > 0.01) {
                const totalsMessage = document.getElementById('macroTotalsMessage');
                if (totalsMessage) {
                    totalsMessage.style.display = 'block';
                }
                return;
            }
            
            // Hide macro section, show activity factor section
            document.getElementById('macroSetMacrosSection').style.display = 'none';
            document.getElementById('macroActivityFactorSection').style.display = 'block';
        });
    }
    
    // Back button on macro screen (goes back to body fat screen)
    const macrosBackButton = document.getElementById('macroMacrosBackButton');
    if (macrosBackButton) {
        macrosBackButton.addEventListener('click', () => {
            document.getElementById('macroSetMacrosSection').style.display = 'none';
            document.getElementById('macroBodyFatSection').style.display = 'block';
        });
    }
    
    // Form validation
    const calcForm = document.getElementById('macroCalcForm');
    if (calcForm) {
        calcForm.addEventListener('input', () => {
            const requiredInputs = Array.from(calcForm.querySelectorAll('input[required]'));
            const allInputsCompleted = requiredInputs.every(input => input.value.trim() !== '');
            const submitButton = document.getElementById('macroCalculateBtn');
            if (submitButton) {
                submitButton.disabled = !allInputsCompleted;
            }
        });
    }
    
    // Macro percentage validation
    const macroProteinInput = document.getElementById('macroProtein');
    const macroFatInput = document.getElementById('macroFat');
    const macroCarbsInput = document.getElementById('macroCarbs');
    
    function validateMacroTotals() {
        const protein = parseFloat(macroProteinInput?.value) || 0;
        const fat = parseFloat(macroFatInput?.value) || 0;
        const carbs = parseFloat(macroCarbsInput?.value) || 0;
        
        // Check if all three fields are filled
        const allFilled = macroProteinInput?.value !== '' && 
                         macroFatInput?.value !== '' && 
                         macroCarbsInput?.value !== '';
        
        // Find the totals message in the current visible section
        const setMacrosSection = document.getElementById('macroSetMacrosSection');
        const macroTotalsMessage = setMacrosSection?.querySelector('#macroTotalsMessage');
        
        if (allFilled) {
            const total = protein + fat + carbs;
            if (Math.abs(total - 100) > 0.01) {
                if (macroTotalsMessage) {
                    macroTotalsMessage.style.display = 'block';
                    const p = macroTotalsMessage.querySelector('p');
                    if (p) {
                        p.textContent = `The total percentage must equal 100%. Current total: ${total.toFixed(1)}%`;
                    }
                }
            } else {
                if (macroTotalsMessage) {
                    macroTotalsMessage.style.display = 'none';
                }
            }
        } else {
            if (macroTotalsMessage) {
                macroTotalsMessage.style.display = 'none';
            }
        }
    }
    
    if (macroProteinInput) {
        macroProteinInput.addEventListener('input', validateMacroTotals);
    }
    if (macroFatInput) {
        macroFatInput.addEventListener('input', validateMacroTotals);
    }
    if (macroCarbsInput) {
        macroCarbsInput.addEventListener('input', validateMacroTotals);
    }
    
    // Collapsible ChatGPT tip
    const chatGPTTipHeader = document.getElementById('macroChatGPTTipHeader');
    const chatGPTTipContent = document.getElementById('macroChatGPTTipContent');
    const expandTipBtn = document.getElementById('macroExpandTipBtn');
    
    if (chatGPTTipHeader && chatGPTTipContent && expandTipBtn) {
        const toggleTip = () => {
            const isExpanded = chatGPTTipContent.style.display !== 'none';
            if (isExpanded) {
                chatGPTTipContent.style.display = 'none';
                expandTipBtn.classList.remove('expanded');
            } else {
                chatGPTTipContent.style.display = 'block';
                expandTipBtn.classList.add('expanded');
            }
        };
        
        chatGPTTipHeader.addEventListener('click', toggleTip);
        expandTipBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTip();
        });
    }
    
    // Collapsible Body Fat Info
    const bodyFatInfoHeader = document.getElementById('macroBodyFatInfoHeader');
    const bodyFatInfoContent = document.getElementById('macroBodyFatInfoContent');
    const expandBodyFatInfoBtn = document.getElementById('macroExpandBodyFatInfoBtn');
    
    if (bodyFatInfoHeader && bodyFatInfoContent && expandBodyFatInfoBtn) {
        const toggleBodyFatInfo = () => {
            const isExpanded = bodyFatInfoContent.style.display !== 'none';
            if (isExpanded) {
                bodyFatInfoContent.style.display = 'none';
                expandBodyFatInfoBtn.classList.remove('expanded');
            } else {
                bodyFatInfoContent.style.display = 'block';
                expandBodyFatInfoBtn.classList.add('expanded');
            }
        };
        
        bodyFatInfoHeader.addEventListener('click', toggleBodyFatInfo);
        expandBodyFatInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleBodyFatInfo();
        });
    }
    
    // Collapsible Macros Info
    const macrosInfoHeader = document.getElementById('macroMacrosInfoHeader');
    const macrosInfoContent = document.getElementById('macroMacrosInfoContent');
    const expandMacrosInfoBtn = document.getElementById('macroExpandMacrosInfoBtn');
    
    if (macrosInfoHeader && macrosInfoContent && expandMacrosInfoBtn) {
        const toggleMacrosInfo = () => {
            const isExpanded = macrosInfoContent.style.display !== 'none';
            if (isExpanded) {
                macrosInfoContent.style.display = 'none';
                expandMacrosInfoBtn.classList.remove('expanded');
            } else {
                macrosInfoContent.style.display = 'block';
                expandMacrosInfoBtn.classList.add('expanded');
            }
        };
        
        macrosInfoHeader.addEventListener('click', toggleMacrosInfo);
        expandMacrosInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMacrosInfo();
        });
    }
    
    // Collapsible Activity Info
    const activityInfoHeader = document.getElementById('macroActivityInfoHeader');
    const activityInfoContent = document.getElementById('macroActivityInfoContent');
    const expandActivityInfoBtn = document.getElementById('macroExpandActivityInfoBtn');
    
    if (activityInfoHeader && activityInfoContent && expandActivityInfoBtn) {
        const toggleActivityInfo = () => {
            const isExpanded = activityInfoContent.style.display !== 'none';
            if (isExpanded) {
                activityInfoContent.style.display = 'none';
                expandActivityInfoBtn.classList.remove('expanded');
            } else {
                activityInfoContent.style.display = 'block';
                expandActivityInfoBtn.classList.add('expanded');
            }
        };
        
        activityInfoHeader.addEventListener('click', toggleActivityInfo);
        expandActivityInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleActivityInfo();
        });
    }
    
    // Collapsible Results Info
    const resultsInfoHeader = document.getElementById('macroResultsInfoHeader');
    const resultsInfoContent = document.getElementById('macroResultsInfoContent');
    const expandResultsInfoBtn = document.getElementById('macroExpandResultsInfoBtn');
    
    if (resultsInfoHeader && resultsInfoContent && expandResultsInfoBtn) {
        const toggleResultsInfo = () => {
            const isExpanded = resultsInfoContent.style.display !== 'none';
            if (isExpanded) {
                resultsInfoContent.style.display = 'none';
                expandResultsInfoBtn.classList.remove('expanded');
            } else {
                resultsInfoContent.style.display = 'block';
                expandResultsInfoBtn.classList.add('expanded');
            }
        };
        
        resultsInfoHeader.addEventListener('click', toggleResultsInfo);
        expandResultsInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleResultsInfo();
        });
    }
    
    // Collapsible Meal Plan Info
    const mealPlanInfoHeader = document.getElementById('macroMealPlanInfoHeader');
    const mealPlanInfoContent = document.getElementById('macroMealPlanInfoContent');
    const expandMealPlanInfoBtn = document.getElementById('macroExpandMealPlanInfoBtn');
    
    if (mealPlanInfoHeader && mealPlanInfoContent && expandMealPlanInfoBtn) {
        const toggleMealPlanInfo = () => {
            const isExpanded = mealPlanInfoContent.style.display !== 'none';
            if (isExpanded) {
                mealPlanInfoContent.style.display = 'none';
                expandMealPlanInfoBtn.classList.remove('expanded');
            } else {
                mealPlanInfoContent.style.display = 'block';
                expandMealPlanInfoBtn.classList.add('expanded');
            }
        };
        
        mealPlanInfoHeader.addEventListener('click', toggleMealPlanInfo);
        expandMealPlanInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMealPlanInfo();
        });
    }
    
    // Collapsible Meal Plan Display Info
    const mealPlanDisplayInfoHeader = document.getElementById('macroMealPlanDisplayInfoHeader');
    const mealPlanDisplayInfoContent = document.getElementById('macroMealPlanDisplayInfoContent');
    const expandMealPlanDisplayInfoBtn = document.getElementById('macroExpandMealPlanDisplayInfoBtn');
    
    if (mealPlanDisplayInfoHeader && mealPlanDisplayInfoContent && expandMealPlanDisplayInfoBtn) {
        const toggleMealPlanDisplayInfo = () => {
            const isExpanded = mealPlanDisplayInfoContent.style.display !== 'none';
            if (isExpanded) {
                mealPlanDisplayInfoContent.style.display = 'none';
                expandMealPlanDisplayInfoBtn.classList.remove('expanded');
            } else {
                mealPlanDisplayInfoContent.style.display = 'block';
                expandMealPlanDisplayInfoBtn.classList.add('expanded');
            }
        };
        
        mealPlanDisplayInfoHeader.addEventListener('click', toggleMealPlanDisplayInfo);
        expandMealPlanDisplayInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMealPlanDisplayInfo();
        });
    }

    // Activity Factor screen buttons
    const activityFactorGoButton = document.getElementById('macroActivityFactorGoButton');
    if (activityFactorGoButton) {
        activityFactorGoButton.addEventListener('click', () => {
            // Calculate and show results
            calculateMacros();
        });
    }
    
    const activityFactorBackButton = document.getElementById('macroActivityFactorBackButton');
    if (activityFactorBackButton) {
        activityFactorBackButton.addEventListener('click', () => {
            document.getElementById('macroActivityFactorSection').style.display = 'none';
            document.getElementById('macroSetMacrosSection').style.display = 'block';
        });
    }
    
    // Back button from results (goes back to Activity Factor screen)
    const backButton = document.getElementById('macroBackButton');
    if (backButton) {
        backButton.addEventListener('click', () => {
            document.getElementById('macroResultsSection').style.display = 'none';
            document.getElementById('macroActivityFactorSection').style.display = 'block';
        });
    }

    // Go button on results (goes to meal plan section)
    const createMealPlanButton = document.getElementById('macroCreateMealPlanButton');
    if (createMealPlanButton) {
        createMealPlanButton.addEventListener('click', () => {
            document.getElementById('macroResultsSection').style.display = 'none';
            document.getElementById('macroMealPlanSection').style.display = 'block';
            
            // Restore number of meals if we have saved data
            if (savedNumberOfMeals) {
                const mealsInput = document.getElementById('macroMeals');
                if (mealsInput) {
                    mealsInput.value = savedNumberOfMeals;
                }
            }
        });
    }
    
    // Meal plan button
    const mealPlanButton = document.getElementById('macroMealPlanButton');
    if (mealPlanButton) {
        mealPlanButton.addEventListener('click', () => {
            const meals = parseInt(document.getElementById('macroMeals').value);
            createMealPlan();
            // After creating the meal plan, restore saved data if it exists and number of meals matches
            if (savedMealPlanData && savedNumberOfMeals && parseInt(savedNumberOfMeals) === meals) {
                setTimeout(() => {
                    restoreMealPlan(savedMealPlanData);
                }, 100);
            }
        });
    }

    // Back button from meal plan display (goes back to meal plan section)
    const mealPlanDisplayBackButton = document.getElementById('macroMealPlanDisplayBackButton');
    if (mealPlanDisplayBackButton) {
        mealPlanDisplayBackButton.addEventListener('click', () => {
            document.getElementById('macroMealPlanDisplay').style.display = 'none';
            document.getElementById('macroMealPlanSection').style.display = 'block';
            
            // Restore number of meals in the input
            if (savedNumberOfMeals) {
                const mealsInput = document.getElementById('macroMeals');
                if (mealsInput) {
                    mealsInput.value = savedNumberOfMeals;
                }
            }
        });
    }
    
    // Back button from meal plan section
    const mealPlanSectionBackButton = document.getElementById('macroMealPlanSectionBackButton');
    if (mealPlanSectionBackButton) {
        mealPlanSectionBackButton.addEventListener('click', () => {
            document.getElementById('macroMealPlanSection').style.display = 'none';
            document.getElementById('macroResultsSection').style.display = 'block';
        });
    }
    
    // Back button from finished section (goes back to meal plan display)
    const finishedSectionBackButton = document.getElementById('macroFinishedSectionBackButton');
    if (finishedSectionBackButton) {
        finishedSectionBackButton.addEventListener('click', () => {
            const finishedSection = document.getElementById('macroFinished');
            const mealPlanDisplay = document.getElementById('macroMealPlanDisplay');
            const mealPlanButtons = document.getElementById('macroMealPlanButtons');
            
            if (finishedSection) finishedSection.style.display = 'none';
            if (mealPlanDisplay) mealPlanDisplay.style.display = 'block';
            if (mealPlanButtons) {
                mealPlanButtons.style.display = 'flex';
            }
            
            // Restore meal plan data
            restoreMealPlanDisplay();
        });
    }

    // Go button on meal plan display (saves and goes to finished section)
    const finishedButton = document.getElementById('macroFinishedButton');
    if (finishedButton) {
        finishedButton.addEventListener('click', async () => {
            try {
                await saveMacroPlan();
                displaySavedPlan();
                // Hide meal plan table and buttons, show finished section
                const mealPlanDisplay = document.getElementById('macroMealPlanDisplay');
                const mealPlanButtons = document.getElementById('macroMealPlanButtons');
                const finishedSection = document.getElementById('macroFinished');
                if (mealPlanDisplay) mealPlanDisplay.style.display = 'none';
                if (mealPlanButtons) mealPlanButtons.style.display = 'none';
                if (finishedSection) finishedSection.style.display = 'block';
            } catch (error) {
                console.error('Error saving meal plan:', error);
                alert('Error saving meal plan. Please try again.');
            }
        });
    }
    
    // Load saved plan on initialization
    loadMacroPlan();
}

// Initialize macro page state
function initializeMacroPage() {
    // Hide all sections initially - loadMacroPlan will show the appropriate one
    const resultsSection = document.getElementById('macroResultsSection');
    const bodyFatSection = document.getElementById('macroBodyFatSection');
    const setMacrosSection = document.getElementById('macroSetMacrosSection');
    const activityFactorSection = document.getElementById('macroActivityFactorSection');
    const mealPlanSection = document.getElementById('macroMealPlanSection');
    const mealPlanDisplay = document.getElementById('macroMealPlanDisplay');
    const mealPlanButtons = document.getElementById('macroMealPlanButtons');
    const finishedSection = document.getElementById('macroFinished');
    const calcForm = document.getElementById('macroCalcForm');
    
    if (resultsSection) resultsSection.style.display = 'none';
    if (bodyFatSection) bodyFatSection.style.display = 'none';
    if (setMacrosSection) setMacrosSection.style.display = 'none';
    if (activityFactorSection) activityFactorSection.style.display = 'none';
    if (mealPlanSection) mealPlanSection.style.display = 'none';
    if (mealPlanDisplay) mealPlanDisplay.style.display = 'none';
    // Don't hide buttons here - they'll be shown when meal plan display is shown
    if (finishedSection) finishedSection.style.display = 'none';
    
    // Show form by default - loadMacroPlan will override if a plan exists
    if (calcForm) calcForm.style.display = 'block';
    
    // Set today's date
    const today = new Date();
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dateString = today.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
    const dateDisplay = document.getElementById('macroDateDisplay');
    if (dateDisplay) {
        dateDisplay.textContent = `${weekdays[today.getDay()]}, ${dateString}`;
    }
}

// Toggle element display
function toggleElementDisplay(id) {
    const element = document.getElementById(id);
    if (element) {
        if (element.style.display === "none") {
            element.style.display = "block";
        } else {
            element.style.display = "none";
        }
    }
}

// Calculate macros
function calculateMacros() {
    const age = parseFloat(document.getElementById('macroAge').value);
    const gender = document.getElementById('macroGender').value;
    const weightPounds = parseFloat(document.getElementById('macroWeight').value);
    const heightInches = parseFloat(document.getElementById('macroHeight').value);
    const bodyFatPercentage = parseFloat(document.getElementById('macroBodyfat').value);
    const activityFactor = parseFloat(document.getElementById('macroActivityFactor').value);
    const proteinPercentage = parseFloat(document.getElementById('macroProtein').value) / 100;
    const carbsPercentage = parseFloat(document.getElementById('macroCarbs').value) / 100;
    const fatPercentage = parseFloat(document.getElementById('macroFat').value) / 100;

    const totalPercentage = proteinPercentage + carbsPercentage + fatPercentage;

    if (Math.abs(totalPercentage - 1.0) > 0.01) {
        document.getElementById('macroTotalsMessage').style.display = 'block';
        return;
    }

    document.getElementById('macroTotalsMessage').style.display = 'none';

    // Convert to metric
    const weightKg = weightPounds / 2.2046;
    const heightCm = heightInches * 2.54;

    // Katch-McArdle formula
    const bmr = 370 + 21.6 * (weightKg * (1 - bodyFatPercentage / 100));
    const tdee = bmr * activityFactor;
    const dailyCalories = tdee;

    // Calculate grams
    const proteinGrams = (dailyCalories * proteinPercentage) / 4;
    const carbsGrams = (dailyCalories * carbsPercentage) / 4;
    const fatGrams = (dailyCalories * fatPercentage) / 9;

    // Store state
    macroCalculatorState = {
        dailyCalories: dailyCalories,
        proteinGrams: proteinGrams,
        fatGrams: fatGrams,
        carbsGrams: carbsGrams,
        proteinPercent: document.getElementById('macroProtein').value,
        fatPercent: document.getElementById('macroFat').value,
        carbsPercent: document.getElementById('macroCarbs').value
    };

    // Display results
    displayMacroResults();
    
    // Hide activity factor section, show results
    document.getElementById('macroActivityFactorSection').style.display = 'none';
    document.getElementById('macroResultsSection').style.display = 'block';
}

// Display user inputs in results section
function displayMacroInputs() {
    const inputsDisplay = document.getElementById('macroResultsInputsDisplay');
    if (!inputsDisplay) return;
    
    const age = document.getElementById('macroAge')?.value || '';
    const gender = document.getElementById('macroGender')?.value || '';
    const height = document.getElementById('macroHeight')?.value || '';
    const weight = document.getElementById('macroWeight')?.value || '';
    const bodyFat = document.getElementById('macroBodyfat')?.value || '';
    const activityFactorSelect = document.getElementById('macroActivityFactor');
    const activityFactorValue = activityFactorSelect?.value || '';
    const activityFactorText = activityFactorSelect?.options[activityFactorSelect.selectedIndex]?.text || '';
    const proteinPercent = document.getElementById('macroProtein')?.value || '';
    const fatPercent = document.getElementById('macroFat')?.value || '';
    const carbsPercent = document.getElementById('macroCarbs')?.value || '';
    
    const genderText = gender === 'male' ? 'Male' : gender === 'female' ? 'Female' : gender;
    
    let html = '<div class="macro-results-inputs-grid">';
    html += `<div><strong>Age:</strong> ${age} years</div>`;
    html += `<div><strong>Gender:</strong> ${genderText}</div>`;
    html += `<div><strong>Height:</strong> ${height} inches</div>`;
    html += `<div><strong>Weight:</strong> ${weight} lbs</div>`;
    html += `<div><strong>Body Fat:</strong> ${bodyFat}%</div>`;
    html += `<div><strong>Activity Level:</strong> ${activityFactorText}</div>`;
    html += `<div><strong>Macros:</strong> Protein ${proteinPercent}% | Fat ${fatPercent}% | Carbs ${carbsPercent}%</div>`;
    html += '</div>';
    
    inputsDisplay.innerHTML = html;
}

// Display macro results
function displayMacroResults() {
    const state = macroCalculatorState;
    
    // Display user inputs
    displayMacroInputs();
    
    // Daily calories
    document.getElementById('macroResultCalories').textContent = state.dailyCalories.toFixed(0);
    document.getElementById('macroCalDisplay').textContent = state.dailyCalories.toFixed(0) + " Total Calories";

    // Protein
    document.getElementById('macroProteinOverallPercent').textContent = state.proteinPercent + "%";
    document.getElementById('macroProteinInGrams').textContent = state.proteinGrams.toFixed(0) + "g";
    document.getElementById('macroProteinInCalories').textContent = (state.proteinGrams * 4).toFixed(0);

    // Fat
    document.getElementById('macroFatOverallPercent').textContent = state.fatPercent + "%";
    document.getElementById('macroFatInGrams').textContent = state.fatGrams.toFixed(0) + "g";
    document.getElementById('macroFatInCalories').textContent = (state.fatGrams * 9).toFixed(0);

    // Carbs
    document.getElementById('macroCarbsOverallPercent').textContent = state.carbsPercent + "%";
    document.getElementById('macroCarbsInGrams').textContent = state.carbsGrams.toFixed(0) + "g";
    document.getElementById('macroCarbsInCalories').textContent = (state.carbsGrams * 4).toFixed(0);
    
    // Calculate and display totals
    const totalGrams = state.proteinGrams + state.fatGrams + state.carbsGrams;
    const totalCalories = (state.proteinGrams * 4) + (state.fatGrams * 9) + (state.carbsGrams * 4);
    document.getElementById('macroTotalGrams').textContent = totalGrams.toFixed(0) + "g";
    document.getElementById('macroTotalCalories').textContent = totalCalories.toFixed(0);

    // Set meal plan headers
    document.getElementById('macroProtDisplay').textContent = `Protein (${state.proteinPercent}%)`;
    document.getElementById('macroFatDisplay').textContent = `Fat (${state.fatPercent}%)`;
    document.getElementById('macroCarbsDisplay').textContent = `Carbs (${state.carbsPercent}%)`;
}

// Create meal plan
function createMealPlan() {
    const meals = parseInt(document.getElementById('macroMeals').value);
    if (!meals || meals < 1 || meals > 10) {
        alert('Please enter a number of meals between 1 and 10');
        return;
    }

    const tableBody = document.getElementById('macroMealsTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';

    const state = macroCalculatorState;

    // Create meal rows
    for (let i = 1; i <= meals; i++) {
        const row = document.createElement('tr');
        row.id = `macro-meal-${i}`;
        
        row.innerHTML = `
            <td>
                <input type="text" class="macro-meal-name-input" data-meal="${i}" value="Meal ${i}" placeholder="Meal ${i}">
            </td>
            <td>
                <input type="number" min="0" max="100" step="1" class="macro-meal-input macro-protein-input" data-meal="${i}" data-macro="protein">
                <span class="macro-meal-percent">%</span>
                <span class="macro-meal-grams"></span>
            </td>
            <td>
                <input type="number" min="0" max="100" step="1" class="macro-meal-input macro-fat-input" data-meal="${i}" data-macro="fat">
                <span class="macro-meal-percent">%</span>
                <span class="macro-meal-grams"></span>
            </td>
            <td>
                <input type="number" min="0" max="100" step="1" class="macro-meal-input macro-carbs-input" data-meal="${i}" data-macro="carbs">
                <span class="macro-meal-percent">%</span>
                <span class="macro-meal-grams"></span>
            </td>
        `;
        
        tableBody.appendChild(row);
    }

    // Add totals row
    const totalRow = document.createElement('tr');
    totalRow.id = 'macro-meal-total';
    totalRow.innerHTML = `
        <td><strong>Total %</strong></td>
        <td id="macro-total-protein"></td>
        <td id="macro-total-fat"></td>
        <td id="macro-total-carbs"></td>
    `;
    tableBody.appendChild(totalRow);

    // Add event listeners to inputs
    tableBody.querySelectorAll('.macro-meal-input').forEach(input => {
        input.addEventListener('input', updateMealPlanTotals);
    });

    // Show meal plan display
    const mealPlanDisplay = document.getElementById('macroMealPlanDisplay');
    const mealPlanButtons = document.getElementById('macroMealPlanButtons');
    
    document.getElementById('macroMealPlanSection').style.display = 'none';
    if (mealPlanDisplay) {
        mealPlanDisplay.style.display = 'block';
    }
    
    // Always ensure buttons are visible when meal plan display is shown
    if (mealPlanButtons) {
        mealPlanButtons.style.display = 'flex';
    }
    
    // Initialize button state
    const finishButton = document.getElementById('macroFinishedButton');
    if (finishButton) {
        finishButton.disabled = true; // Start disabled, will be enabled by updateMealPlanTotals if valid
    }
    
    updateMealPlanTotals();
}

// Update meal plan totals
function updateMealPlanTotals() {
    const state = macroCalculatorState;
    let sumProtein = 0;
    let sumFat = 0;
    let sumCarbs = 0;

    const tableBody = document.getElementById('macroMealsTableBody');
    if (!tableBody) return;

    // Calculate totals and update grams display
    tableBody.querySelectorAll('tr:not(#macro-meal-total)').forEach(row => {
        const proteinInput = row.querySelector('.macro-protein-input');
        const fatInput = row.querySelector('.macro-fat-input');
        const carbsInput = row.querySelector('.macro-carbs-input');

        const proteinPercent = parseFloat(proteinInput.value) || 0;
        const fatPercent = parseFloat(fatInput.value) || 0;
        const carbsPercent = parseFloat(carbsInput.value) || 0;

        sumProtein += proteinPercent;
        sumFat += fatPercent;
        sumCarbs += carbsPercent;

        // Update grams display for each macro
        const proteinGrams = (state.proteinGrams * proteinPercent / 100).toFixed(1);
        const fatGrams = (state.fatGrams * fatPercent / 100).toFixed(1);
        const carbsGrams = (state.carbsGrams * carbsPercent / 100).toFixed(1);

        const proteinGramsSpan = proteinInput.parentElement.querySelector('.macro-meal-grams');
        const fatGramsSpan = fatInput.parentElement.querySelector('.macro-meal-grams');
        const carbsGramsSpan = carbsInput.parentElement.querySelector('.macro-meal-grams');
        
        if (proteinGramsSpan) proteinGramsSpan.textContent = ` (${proteinGrams}g)`;
        if (fatGramsSpan) fatGramsSpan.textContent = ` (${fatGrams}g)`;
        if (carbsGramsSpan) carbsGramsSpan.textContent = ` (${carbsGrams}g)`;
    });

    // Update totals row
    document.getElementById('macro-total-protein').textContent = sumProtein;
    document.getElementById('macro-total-fat').textContent = sumFat;
    document.getElementById('macro-total-carbs').textContent = sumCarbs;

    // Color code totals
    const totalProtein = document.getElementById('macro-total-protein');
    const totalFat = document.getElementById('macro-total-fat');
    const totalCarbs = document.getElementById('macro-total-carbs');

    if (sumProtein === 100) {
        totalProtein.style.color = '#4CAF50';
        totalProtein.style.fontWeight = 'bold';
    } else {
        totalProtein.style.color = 'red';
        totalProtein.style.fontWeight = 'normal';
    }

    if (sumFat === 100) {
        totalFat.style.color = '#4CAF50';
        totalFat.style.fontWeight = 'bold';
    } else {
        totalFat.style.color = 'red';
        totalFat.style.fontWeight = 'normal';
    }

    if (sumCarbs === 100) {
        totalCarbs.style.color = '#4CAF50';
        totalCarbs.style.fontWeight = 'bold';
    } else {
        totalCarbs.style.color = 'red';
        totalCarbs.style.fontWeight = 'normal';
    }

    // Enable/disable finish button
    const finishButton = document.getElementById('macroFinishedButton');
    const totalsMessage = document.getElementById('macroMealPlanTotalsMessage');
    
    if (finishButton) {
        // Use a small tolerance for floating point comparison
        const tolerance = 0.01;
        const proteinValid = Math.abs(sumProtein - 100) < tolerance;
        const fatValid = Math.abs(sumFat - 100) < tolerance;
        const carbsValid = Math.abs(sumCarbs - 100) < tolerance;
        
        if (proteinValid && fatValid && carbsValid) {
            finishButton.disabled = false;
            if (totalsMessage) {
                totalsMessage.style.display = 'none';
            }
        } else {
            finishButton.disabled = true;
            if (totalsMessage) {
                totalsMessage.style.display = 'block';
                const messageText = totalsMessage.querySelector('p');
                if (messageText) {
                    messageText.textContent = `The total percentage for each macro must equal 100%. Current totals: Protein ${sumProtein.toFixed(1)}%, Fat ${sumFat.toFixed(1)}%, Carbs ${sumCarbs.toFixed(1)}%`;
                }
            }
        }
    }
}

// Save macro plan to database
async function saveMacroPlan() {
    try {
        // Get API_BASE and token from app.js scope
        const apiBase = window.API_BASE || '/api';
        const authToken = window.token || localStorage.getItem('token');
        
        if (!authToken) {
            console.error('No authentication token found');
            return;
        }
        
        const state = macroCalculatorState;
        
        // Get meal plan data if it exists
        const mealPlanData = getMealPlanData();
        
        // Get all form input values
        const formData = {
            age: document.getElementById('macroAge')?.value || '',
            gender: document.getElementById('macroGender')?.value || '',
            height: document.getElementById('macroHeight')?.value || '',
            weight: document.getElementById('macroWeight')?.value || '',
            bodyFat: document.getElementById('macroBodyfat')?.value || '',
            activityFactor: document.getElementById('macroActivityFactor')?.value || '',
            proteinPercent: document.getElementById('macroProtein')?.value || '',
            fatPercent: document.getElementById('macroFat')?.value || '',
            carbsPercent: document.getElementById('macroCarbs')?.value || '',
            numberOfMeals: document.getElementById('macroMeals')?.value || ''
        };
        
        const planData = {
            formData: formData,
            dailyCalories: state.dailyCalories,
            proteinGrams: state.proteinGrams,
            fatGrams: state.fatGrams,
            carbsGrams: state.carbsGrams,
            proteinPercent: state.proteinPercent,
            fatPercent: state.fatPercent,
            carbsPercent: state.carbsPercent,
            mealPlan: mealPlanData,
            savedAt: new Date().toISOString()
        };
        
        // Store the saved meal plan data for restoration when navigating back
        savedMealPlanData = mealPlanData;
        savedNumberOfMeals = formData.numberOfMeals;
        
        const response = await fetch(`${apiBase}/macro-plan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ planData })
        });
        
        if (response.ok) {
            console.log('Macro plan saved successfully');
        } else {
            console.error('Failed to save macro plan');
        }
    } catch (error) {
        console.error('Error saving macro plan:', error);
    }
}

// Load macro plan from database
async function loadMacroPlan() {
    try {
        // Get API_BASE and token from app.js scope
        const apiBase = window.API_BASE || '/api';
        const authToken = window.token || localStorage.getItem('token');
        
        if (!authToken) {
            return; // Not logged in, skip loading
        }
        
        const response = await fetch(`${apiBase}/macro-plan`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.plan) {
                // Restore form inputs
                if (data.plan.formData) {
                    const formData = data.plan.formData;
                    if (formData.age && document.getElementById('macroAge')) {
                        document.getElementById('macroAge').value = formData.age;
                    }
                    if (formData.gender && document.getElementById('macroGender')) {
                        document.getElementById('macroGender').value = formData.gender;
                    }
                    if (formData.height && document.getElementById('macroHeight')) {
                        document.getElementById('macroHeight').value = formData.height;
                    }
                    if (formData.weight && document.getElementById('macroWeight')) {
                        document.getElementById('macroWeight').value = formData.weight;
                    }
                    if (formData.bodyFat && document.getElementById('macroBodyfat')) {
                        document.getElementById('macroBodyfat').value = formData.bodyFat;
                    }
                    if (formData.activityFactor && document.getElementById('macroActivityFactor')) {
                        document.getElementById('macroActivityFactor').value = formData.activityFactor;
                    }
                    if (formData.proteinPercent && document.getElementById('macroProtein')) {
                        document.getElementById('macroProtein').value = formData.proteinPercent;
                    }
                    if (formData.fatPercent && document.getElementById('macroFat')) {
                        document.getElementById('macroFat').value = formData.fatPercent;
                    }
                    if (formData.carbsPercent && document.getElementById('macroCarbs')) {
                        document.getElementById('macroCarbs').value = formData.carbsPercent;
                    }
                }
                
                // Restore calculator state
                macroCalculatorState = {
                    dailyCalories: data.plan.dailyCalories || 0,
                    proteinGrams: data.plan.proteinGrams || 0,
                    fatGrams: data.plan.fatGrams || 0,
                    carbsGrams: data.plan.carbsGrams || 0,
                    proteinPercent: data.plan.proteinPercent || 0,
                    fatPercent: data.plan.fatPercent || 0,
                    carbsPercent: data.plan.carbsPercent || 0
                };
                
                // If we have calculated results, display them
                if (macroCalculatorState.dailyCalories > 0) {
                    displayMacroResults();
                }
                
                // Store saved meal plan data for restoration when navigating back
                if (data.plan.mealPlan && data.plan.mealPlan.length > 0) {
                    savedMealPlanData = data.plan.mealPlan;
                } else {
                    savedMealPlanData = null;
                }
                
                if (data.plan.formData && data.plan.formData.numberOfMeals) {
                    savedNumberOfMeals = data.plan.formData.numberOfMeals;
                } else {
                    savedNumberOfMeals = null;
                }
                
                // Check if we're viewing the macro tab
                const macroContent = document.getElementById('macroContent');
                const isMacroTabVisible = macroContent && macroContent.style.display !== 'none';
                
                // If meal plan data exists, restore it
                if (data.plan.mealPlan && data.plan.mealPlan.length > 0) {
                    // Restore number of meals
                    if (data.plan.formData && data.plan.formData.numberOfMeals) {
                        const mealsInput = document.getElementById('macroMeals');
                        if (mealsInput) {
                            mealsInput.value = data.plan.formData.numberOfMeals;
                            // Recreate the meal plan table
                            createMealPlan();
                            
                            // Restore meal plan percentages after a short delay to ensure table is created
                            setTimeout(() => {
                                restoreMealPlan(data.plan.mealPlan);
                            }, 200);
                        }
                    }
                }
                
                // If we have calculated results and we're viewing the macro tab, show the Results screen
                if (isMacroTabVisible && macroCalculatorState.dailyCalories > 0) {
                    // Hide all sections and show results
                    const calcForm = document.getElementById('macroCalcForm');
                    const bodyFatSection = document.getElementById('macroBodyFatSection');
                    const setMacrosSection = document.getElementById('macroSetMacrosSection');
                    const activityFactorSection = document.getElementById('macroActivityFactorSection');
                    const mealPlanSection = document.getElementById('macroMealPlanSection');
                    const mealPlanDisplay = document.getElementById('macroMealPlanDisplay');
                    const mealPlanButtons = document.getElementById('macroMealPlanButtons');
                    const finishedSection = document.getElementById('macroFinished');
                    const resultsSection = document.getElementById('macroResultsSection');
                    
                    if (calcForm) calcForm.style.display = 'none';
                    if (bodyFatSection) bodyFatSection.style.display = 'none';
                    if (setMacrosSection) setMacrosSection.style.display = 'none';
                    if (activityFactorSection) activityFactorSection.style.display = 'none';
                    if (mealPlanSection) mealPlanSection.style.display = 'none';
                    if (mealPlanDisplay) mealPlanDisplay.style.display = 'none';
                    if (mealPlanButtons) mealPlanButtons.style.display = 'none';
                    if (finishedSection) finishedSection.style.display = 'none';
                    if (resultsSection) resultsSection.style.display = 'block';
                }
                
                // If we're in the macro view, show a message that plan was loaded
                if (isMacroTabVisible) {
                    console.log('Macro plan loaded from database');
                }
            }
        }
    } catch (error) {
        // Silently fail - 500 errors are expected if table doesn't exist yet
        console.log('Macro plan not available (table may not exist yet)');
    }
}

// Restore meal plan data to the table
function restoreMealPlan(mealPlanData) {
    if (!mealPlanData || mealPlanData.length === 0) return;
    
    const tableBody = document.getElementById('macroMealsTableBody');
    if (!tableBody) return;
    
    mealPlanData.forEach(meal => {
        const row = tableBody.querySelector(`#macro-meal-${meal.mealNumber}`);
        if (row) {
            const mealNameInput = row.querySelector('.macro-meal-name-input');
            const proteinInput = row.querySelector('.macro-protein-input');
            const fatInput = row.querySelector('.macro-fat-input');
            const carbsInput = row.querySelector('.macro-carbs-input');
            
            if (mealNameInput && meal.mealName) {
                mealNameInput.value = meal.mealName;
            }
            if (proteinInput) proteinInput.value = meal.proteinPercent;
            if (fatInput) fatInput.value = meal.fatPercent;
            if (carbsInput) carbsInput.value = meal.carbsPercent;
        }
    });
    
    // Update totals after restoring - this will enable/disable the button correctly
    updateMealPlanTotals();
}

// Restore meal plan display with saved data when navigating back
function restoreMealPlanDisplay() {
    // Check if meal plan display is visible and has a table
    const mealPlanDisplay = document.getElementById('macroMealPlanDisplay');
    const mealPlanButtons = document.getElementById('macroMealPlanButtons');
    const tableBody = document.getElementById('macroMealsTableBody');
    
    // Always show buttons when meal plan display is visible
    if (mealPlanDisplay && mealPlanDisplay.style.display !== 'none') {
        if (mealPlanButtons) {
            mealPlanButtons.style.display = 'flex';
        }
        
        // If table doesn't exist but we have saved data, create it
        if (!tableBody && savedNumberOfMeals && savedMealPlanData) {
            const mealsInput = document.getElementById('macroMeals');
            if (mealsInput) {
                mealsInput.value = savedNumberOfMeals;
            }
            createMealPlan();
            // Restore data after table is created
            setTimeout(() => {
                if (savedMealPlanData) {
                    restoreMealPlan(savedMealPlanData);
                }
            }, 100);
        } else if (tableBody && savedMealPlanData) {
            // Table exists, check if number of meals matches before restoring
            const currentMeals = tableBody.querySelectorAll('tr:not(#macro-meal-total)').length;
            if (savedNumberOfMeals && parseInt(savedNumberOfMeals) === currentMeals) {
                restoreMealPlan(savedMealPlanData);
            }
        }
    }
}

// Get current meal plan data
function getMealPlanData() {
    const tableBody = document.getElementById('macroMealsTableBody');
    if (!tableBody) return null;
    
    const meals = [];
    tableBody.querySelectorAll('tr:not(#macro-meal-total)').forEach(row => {
        const mealNameInput = row.querySelector('.macro-meal-name-input');
        const proteinInput = row.querySelector('.macro-protein-input');
        const fatInput = row.querySelector('.macro-fat-input');
        const carbsInput = row.querySelector('.macro-carbs-input');
        
        if (proteinInput && fatInput && carbsInput) {
            meals.push({
                mealNumber: parseInt(row.id.replace('macro-meal-', '')),
                mealName: mealNameInput ? (mealNameInput.value || `Meal ${row.id.replace('macro-meal-', '')}`) : `Meal ${row.id.replace('macro-meal-', '')}`,
                proteinPercent: parseFloat(proteinInput.value) || 0,
                fatPercent: parseFloat(fatInput.value) || 0,
                carbsPercent: parseFloat(carbsInput.value) || 0
            });
        }
    });
    
    return meals.length > 0 ? meals : null;
}

// Check if a complete plan exists and show finished section
async function checkAndShowFinishedSection() {
    // Check if we have a complete plan (has meal plan data)
    const tableBody = document.getElementById('macroMealsTableBody');
    const finishedSection = document.getElementById('macroFinished');
    
    if (tableBody && tableBody.querySelectorAll('tr:not(#macro-meal-total)').length > 0 && finishedSection) {
        // We have meal plan data, show finished section
        showFinishedSectionFromLoad();
    }
}

// Show finished section when loading a saved plan
function showFinishedSectionFromLoad() {
    // Hide all other sections
    const calcForm = document.getElementById('macroCalcForm');
    const resultsSection = document.getElementById('macroResultsSection');
    const mealPlanSection = document.getElementById('macroMealPlanSection');
    const mealPlanDisplay = document.getElementById('macroMealPlanDisplay');
    const mealPlanButtons = document.getElementById('macroMealPlanButtons');
    const finishedSection = document.getElementById('macroFinished');
    
    if (calcForm) calcForm.style.display = 'none';
    if (resultsSection) resultsSection.style.display = 'none';
    if (mealPlanSection) mealPlanSection.style.display = 'none';
    if (mealPlanDisplay) mealPlanDisplay.style.display = 'none';
    if (mealPlanButtons) mealPlanButtons.style.display = 'none';
    
    // Display the saved plan and show finished section
    displaySavedPlan();
    if (finishedSection) finishedSection.style.display = 'block';
}

// Display saved plan in easy-to-copy text format
function displaySavedPlan() {
    const state = macroCalculatorState;
    const displayText = document.getElementById('macroPlanDisplayText');
    if (!displayText) return;
    
    const tableBody = document.getElementById('macroMealsTableBody');
    if (!tableBody) {
        displayText.innerHTML = '<p>No meal plan data available.</p>';
        return;
    }
    
    let text = `<div class="macro-plan-summary">\n`;
    text += `<h4>Daily Totals</h4>\n`;
    text += `<p><strong>Calories:</strong> ${state.dailyCalories.toFixed(0)}</p>\n`;
    text += `<p><strong>Protein:</strong> ${state.proteinGrams.toFixed(0)}g (${state.proteinPercent}%)</p>\n`;
    text += `<p><strong>Fat:</strong> ${state.fatGrams.toFixed(0)}g (${state.fatPercent}%)</p>\n`;
    text += `<p><strong>Carbs:</strong> ${state.carbsGrams.toFixed(0)}g (${state.carbsPercent}%)</p>\n`;
    text += `</div>\n\n`;
    
    text += `<div class="macro-meals-text">\n`;
    text += `<h4>Meal Breakdown</h4>\n`;
    
    // Get all meal rows
    const mealRows = tableBody.querySelectorAll('tr:not(#macro-meal-total)');
    mealRows.forEach((row, index) => {
        const mealNum = index + 1;
        const mealNameInput = row.querySelector('.macro-meal-name-input');
        const mealName = mealNameInput ? (mealNameInput.value || `Meal ${mealNum}`) : `Meal ${mealNum}`;
        const proteinInput = row.querySelector('.macro-protein-input');
        const fatInput = row.querySelector('.macro-fat-input');
        const carbsInput = row.querySelector('.macro-carbs-input');
        
        if (proteinInput && fatInput && carbsInput) {
            const proteinPercent = parseFloat(proteinInput.value) || 0;
            const fatPercent = parseFloat(fatInput.value) || 0;
            const carbsPercent = parseFloat(carbsInput.value) || 0;
            
            const proteinGrams = (state.proteinGrams * proteinPercent / 100).toFixed(1);
            const fatGrams = (state.fatGrams * fatPercent / 100).toFixed(1);
            const carbsGrams = (state.carbsGrams * carbsPercent / 100).toFixed(1);
            const mealCalories = (proteinGrams * 4) + (fatGrams * 9) + (carbsGrams * 4);
            
            const mealText = `${mealName}:\nProtein: ${proteinGrams}g (${proteinPercent}%)\nFat: ${fatGrams}g (${fatPercent}%)\nCarbs: ${carbsGrams}g (${carbsPercent}%)\nCalories: ${mealCalories.toFixed(0)}`;
            
            text += `<div class="macro-meal-text-item">\n`;
            text += `<div class="macro-meal-header">\n`;
            text += `<h5>${mealName}</h5>\n`;
            text += `<button class="macro-copy-btn" data-meal-text="${mealText.replace(/"/g, '&quot;').replace(/\n/g, '\\n')}" onclick="copyMealMacros(this)">Copy</button>\n`;
            text += `</div>\n`;
            text += `<div class="macro-meal-text-content" data-meal-text="${mealText.replace(/"/g, '&quot;')}">\n`;
            text += `Protein: ${proteinGrams}g (${proteinPercent}%)<br>\n`;
            text += `Fat: ${fatGrams}g (${fatPercent}%)<br>\n`;
            text += `Carbs: ${carbsGrams}g (${carbsPercent}%)<br>\n`;
            text += `Calories: ${mealCalories.toFixed(0)}\n`;
            text += `</div>\n`;
            text += `</div>\n\n`;
        }
    });
    
    text += `</div>`;
    
    displayText.innerHTML = text;
}

// Copy meal macros to clipboard (global function for onclick)
window.copyMealMacros = async function(button) {
    const mealText = button.dataset.mealText.replace(/\\n/g, '\n');
    try {
        await navigator.clipboard.writeText(mealText);
        // Show feedback
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        button.style.background = '#4CAF50';
        setTimeout(() => {
            button.textContent = originalText;
            button.style.background = '';
        }, 2000);
    } catch (error) {
        console.error('Failed to copy:', error);
        // Fallback: select text
        const textElement = button.closest('.macro-meal-text-item').querySelector('.macro-meal-text-content');
        const range = document.createRange();
        range.selectNodeContents(textElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
}
