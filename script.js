document.addEventListener('DOMContentLoaded', () => {
    const loadVideoButton = document.getElementById('loadVideoButton');
    const videoInput = document.getElementById('videoInput');
    
    if (loadVideoButton && videoInput) {
        loadVideoButton.addEventListener('click', () => {
            videoInput.click();
        });
    }

    const loadSrtButton = document.getElementById('loadSrtButton');
    const srtInput = document.getElementById('srtInput');

    if (loadSrtButton && srtInput) {
        loadSrtButton.addEventListener('click', () => {
            srtInput.click();
        });
    }
});

let subtitles = [];
let questions = [];
let currentQuestionBlockText = '';
let lastProcessedSubtitle = null;
let currentQuestionNumber = null;
let flaggedQuestions = {};
let showQuestionTranslation = true;
let showAnswerTranslation = true;
let isMuted = false;
let pauseAtQuestionEnd = true;
let currentQuestionEndTime = null;
let shouldPauseAfterQuestion = false;
let isFirstAnswer = false;

const videoPlayer = document.getElementById('videoPlayer');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const subtitleDisplay = document.getElementById('subtitleDisplay');
const questionNavigation = document.getElementById('questionNavigation');
const flagButton = document.getElementById('flagButton');
const toggleQuestionTranslation = document.getElementById('toggleQuestionTranslation');
const toggleAnswerTranslation = document.getElementById('toggleAnswerTranslation');
const togglePauseButton = document.getElementById('togglePauseButton');
const soundToggle = document.getElementById('soundToggle');
const statusText = document.getElementById('statusText');

function loadFlaggedQuestions() {
    const saved = localStorage.getItem('flaggedQuestions');
    if (saved) {
        flaggedQuestions = JSON.parse(saved);
    }
}

function saveFlaggedQuestions() {
    localStorage.setItem('flaggedQuestions', JSON.stringify(flaggedQuestions));
}

function toggleFlag() {
    if (currentQuestionNumber === null) return;
    
    if (flaggedQuestions[currentQuestionNumber]) {
        delete flaggedQuestions[currentQuestionNumber];
        flagButton.classList.remove('active');
    } else {
        flaggedQuestions[currentQuestionNumber] = true;
        flagButton.classList.add('active');
    }
    
    saveFlaggedQuestions();
    updateQuestionButtonFlags();
}

function updateQuestionButtonFlags() {
    questions.forEach(question => {
        const btn = questionNavigation.querySelector(`button[data-question="${question.number}"]`);
        if (btn) {
            if (flaggedQuestions[question.number]) {
                btn.classList.add('flagged');
            } else {
                btn.classList.remove('flagged');
            }
        }
    });
}

function loadTranslationPreferences() {
    const saved = localStorage.getItem('translationPreferences');
    if (saved) {
        const prefs = JSON.parse(saved);
        showQuestionTranslation = prefs.question !== false;
        showAnswerTranslation = prefs.answer !== false;
    }
    updateTranslationButtons();
}

function saveTranslationPreferences() {
    localStorage.setItem('translationPreferences', JSON.stringify({
        question: showQuestionTranslation,
        answer: showAnswerTranslation
    }));
}

function updateTranslationButtons() {
    if (showQuestionTranslation) {
        toggleQuestionTranslation.classList.remove('hidden');
    } else {
        toggleQuestionTranslation.classList.add('hidden');
    }
    
    if (showAnswerTranslation) {
        toggleAnswerTranslation.classList.remove('hidden');
    } else {
        toggleAnswerTranslation.classList.add('hidden');
    }
}

function applyTranslationVisibility() {
    const isQuestion = lastProcessedSubtitle && lastProcessedSubtitle.text.trim().startsWith('Question');
    
    if (isQuestion && !showQuestionTranslation) {
        subtitleDisplay.classList.add('hidden-translation');
    } else if (!isQuestion && !showAnswerTranslation) {
        subtitleDisplay.classList.add('hidden-translation');
    } else {
        subtitleDisplay.classList.remove('hidden-translation');
    }
}

function loadSoundPreference() {
    const saved = localStorage.getItem('isMuted');
    if (saved !== null) {
        isMuted = saved === 'true';
    }
    applyMutedState();
}

function saveSoundPreference() {
    localStorage.setItem('isMuted', isMuted);
}

function applyMutedState() {
    videoPlayer.muted = isMuted;
    if (isMuted) {
        soundToggle.classList.add('muted');
        soundToggle.textContent = '🔇';
    } else {
        soundToggle.classList.remove('muted');
        soundToggle.textContent = '🔊';
    }
}

function toggleSound() {
    isMuted = !isMuted;
    saveSoundPreference();
    applyMutedState();
}

function loadPausePreference() {
    const saved = localStorage.getItem('pauseAtQuestionEnd');
    if (saved !== null) {
        pauseAtQuestionEnd = saved === 'true';
    }
    updatePauseButton();
}

function savePausePreference() {
    localStorage.setItem('pauseAtQuestionEnd', pauseAtQuestionEnd);
}

function updatePauseButton() {
    if (pauseAtQuestionEnd) {
        togglePauseButton.classList.remove('hidden');
    } else {
        togglePauseButton.classList.add('hidden');
    }
}

function togglePause() {
    pauseAtQuestionEnd = !pauseAtQuestionEnd;
    savePausePreference();
    updatePauseButton();
    
    // Reset pause flag if disabling the feature
    if (!pauseAtQuestionEnd) {
        shouldPauseAfterQuestion = false;
    }
}

loadFlaggedQuestions();
loadTranslationPreferences();
loadSoundPreference();
loadPausePreference();

function parseSRT(srtContent) {
    const subtitleBlocks = srtContent.trim().split(/\n\s*\n/);
    const parsedSubtitles = [];

    subtitleBlocks.forEach(block => {
        const lines = block.split('\n');
        if (lines.length >= 3) {
            let timeMatch = lines[1].match(/(\d{1,2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2}),(\d{3})/);
            
            if (!timeMatch) {
                timeMatch = lines[1].match(/(\d{1,2}):(\d{2}),(\d{3})\s*-->\s*(\d{1,2}):(\d{2}),(\d{3})/);
                if (timeMatch) {
                    const startTime = parseInt(timeMatch[1]) * 60 + 
                                    parseInt(timeMatch[2]) + 
                                    parseInt(timeMatch[3]) / 1000;
                    
                    const endTime = parseInt(timeMatch[4]) * 60 + 
                                  parseInt(timeMatch[5]) + 
                                  parseInt(timeMatch[6]) / 1000;
                    
                    const text = lines.slice(2).join('\n');
                    
                    parsedSubtitles.push({
                        start: startTime,
                        end: endTime,
                        text: text
                    });
                }
            } else {
                const startTime = parseInt(timeMatch[1]) * 3600 + 
                                parseInt(timeMatch[2]) * 60 + 
                                parseInt(timeMatch[3]) + 
                                parseInt(timeMatch[4]) / 1000;
                
                const endTime = parseInt(timeMatch[5]) * 3600 + 
                              parseInt(timeMatch[6]) * 60 + 
                              parseInt(timeMatch[7]) + 
                              parseInt(timeMatch[8]) / 1000;
                
                const text = lines.slice(2).join('\n');
                
                parsedSubtitles.push({
                    start: startTime,
                    end: endTime,
                    text: text
                });
            }
        }
    });

    return parsedSubtitles;
}

function extractQuestions(subtitles) {
    return subtitles.filter(sub => sub.text.trim().startsWith('Question'))
        .map((sub, index) => {
            const match = sub.text.match(/^Question\s*(\d+)/);
            const number = match ? parseInt(match[1], 10) : null;
            return {
                number: number,
                startTime: sub.start,
                text: sub.text
            };
        })
        .filter(q => q.number !== null);
}

function createQuestionButtons(questions) {
    questionNavigation.innerHTML = '';
    
    if (questions.length === 0) {
        questionNavigation.style.display = 'none';
        return;
    }
    
    questionNavigation.style.display = 'flex';
    
    questions.forEach(question => {
        const btn = document.createElement('button');
        btn.className = 'question-btn';
        btn.textContent = question.number;
        btn.title = `Jump to Question ${question.number}`;
        btn.setAttribute('data-question', question.number);
        
        if (flaggedQuestions[question.number]) {
            btn.classList.add('flagged');
        }
        
        btn.addEventListener('click', () => {
            videoPlayer.currentTime = question.startTime;
            // Reset last processed subtitle to force reprocessing
            lastProcessedSubtitle = null;
            currentQuestionBlockText = '';
            if (videoPlayer.paused) {
                videoPlayer.play();
            }
        });
        questionNavigation.appendChild(btn);
    });
}

function formatSubtitleText(text) {
    const hasCorrect = text.includes('(Correct)');
    
    let formatted = text;
    
    if (hasCorrect) {
        formatted = formatted.replace('(Correct)', '<span class="correct-badge">(Correct)</span>');
    }
    
    // Handle nested parentheses by finding matching pairs
    let result = '';
    let i = 0;
    
    while (i < formatted.length) {
        if (formatted[i] === '(') {
            let depth = 1;
            let start = i;
            i++;
            
            while (i < formatted.length && depth > 0) {
                if (formatted[i] === '(') depth++;
                if (formatted[i] === ')') depth--;
                i++;
            }
            
            const content = formatted.substring(start + 1, i - 1);
            
            // Skip if it's already wrapped (Correct badge)
            if (content.includes('class="correct-badge"')) {
                result += formatted.substring(start, i);
                continue;
            }
            
            // Check if content has Cyrillic characters
            const isCyrillic = /[\u0400-\u04FF]/.test(content);
            if (isCyrillic) {
                result += `<span class="russian-text">${content}</span>`;
            } else {
                result += formatted.substring(start, i);
            }
        } else {
            result += formatted[i];
            i++;
        }
    }
    
    return result;
}

function updateSubtitle() {
    const currentTime = videoPlayer.currentTime;
    const currentSubtitle = subtitles.find(sub => 
        currentTime >= sub.start && currentTime <= sub.end
    );

    if (currentSubtitle && currentSubtitle !== lastProcessedSubtitle) {
        lastProcessedSubtitle = currentSubtitle;

        const formattedText = formatSubtitleText(currentSubtitle.text);
        const isCorrect = currentSubtitle.text.includes('(Correct)');

        if (currentSubtitle.text.trim().startsWith('Question')) {
            // New question detected - reset everything
            currentQuestionBlockText = `<span class="question-line">${formattedText}</span>`;
            isFirstAnswer = true;
            
            // Immediately clear display when new question starts
            subtitleDisplay.innerHTML = currentQuestionBlockText;
            subtitleDisplay.classList.remove('subtitle-placeholder');
            applyTranslationVisibility();
            
            const question = questions.find(q => q.startTime === currentSubtitle.start);
            if (question) {
                currentQuestionNumber = question.number;
                flagButton.style.display = 'block';
                
                if (flaggedQuestions[currentQuestionNumber]) {
                    flagButton.classList.add('active');
                } else {
                    flagButton.classList.remove('active');
                }
            }
            
            // Enable pause after this question ends
            if (pauseAtQuestionEnd) {
                shouldPauseAfterQuestion = true;
            }
            currentQuestionEndTime = currentSubtitle.end;
        } else {
            if (isFirstAnswer) {
                currentQuestionBlockText += `<div class="correct-answer"><span class="answer-line">${formattedText}</span></div>`;
                isFirstAnswer = false;
            } else {
                currentQuestionBlockText += `<span class="answer-line">${formattedText}</span>`;
            }
            // Update end time as we progress through answers
            currentQuestionEndTime = currentSubtitle.end;
        }

        subtitleDisplay.innerHTML = currentQuestionBlockText;
        subtitleDisplay.classList.remove('subtitle-placeholder');
        applyTranslationVisibility();
    }
}

videoInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const url = URL.createObjectURL(file);
        videoPlayer.src = url;
        videoPlayer.style.display = 'block';
        videoPlaceholder.style.display = 'none';
        statusText.textContent = `Video loaded: ${file.name}`;
    }
});

srtInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const srtContent = e.target.result;
            subtitles = parseSRT(srtContent);
            questions = extractQuestions(subtitles);
            createQuestionButtons(questions);
            statusText.textContent = `SRT loaded: ${file.name} (${subtitles.length} subtitles, ${questions.length} questions)`;
            subtitleDisplay.textContent = 'Subtitles loaded. Play video to see them.';
            subtitleDisplay.classList.remove('subtitle-placeholder');
        };
        reader.readAsText(file);
    }
});

videoPlayer.addEventListener('timeupdate', updateSubtitle);

videoPlayer.addEventListener('timeupdate', () => {
    // Check if we should pause after question ends
    if (shouldPauseAfterQuestion && currentQuestionEndTime !== null) {
        const currentTime = videoPlayer.currentTime;
        // Pause 1.5 seconds after the last subtitle of current question ends
        if (currentTime >= currentQuestionEndTime + 1.5) {
            videoPlayer.pause();
            shouldPauseAfterQuestion = false;
        }
    }
});

videoPlayer.addEventListener('play', () => {
    if (subtitles.length === 0) {
        subtitleDisplay.textContent = 'No subtitles loaded';
        subtitleDisplay.classList.add('subtitle-placeholder');
    }
});

flagButton.addEventListener('click', toggleFlag);

toggleQuestionTranslation.addEventListener('click', () => {
    showQuestionTranslation = !showQuestionTranslation;
    saveTranslationPreferences();
    updateTranslationButtons();
    applyTranslationVisibility();
});

toggleAnswerTranslation.addEventListener('click', () => {
    showAnswerTranslation = !showAnswerTranslation;
    saveTranslationPreferences();
    updateTranslationButtons();
    applyTranslationVisibility();
});

updateTranslationButtons();
soundToggle.addEventListener('click', toggleSound);
togglePauseButton.addEventListener('click', togglePause);