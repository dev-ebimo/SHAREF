document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const filePreview = document.getElementById('filePreview');
    const fileNameEl = document.getElementById('fileName');
    const fileSizeEl = document.getElementById('fileSize');
    const removeFileBtn = document.getElementById('removeFileBtn');
    const fileError = document.getElementById('fileError');
    const resourceTitle = document.getElementById('resourceTitle');
    const charCount = document.getElementById('charCount');
    const description = document.getElementById('description');
    
    // Form and Buttons
    const form = document.getElementById('resourceForm');
    const submitBtn = document.getElementById('submitBtn');
    const requiredInputs = form.querySelectorAll('[required]');

    // States
    const stateForm = document.getElementById('uploadStateForm');
    const stateProgress = document.getElementById('uploadStateProgress');
    const stateSuccess = document.getElementById('uploadStateSuccess');
    
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    const ALLOWED_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'];

    let currentFile = null;

    // --- 1. Drag and Drop Handling ---
    dropZone.addEventListener('click', () => fileInput.click());

    ['dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', function() {
        handleFiles(this.files);
    });

    // --- 2. File Validation & Preview ---
    function handleFiles(files) {
        fileError.style.display = 'none';
        
        if (files.length === 0) return;
        const file = files[0];

        // Validate Size
        if (file.size > MAX_FILE_SIZE) {
            showFileError('File exceeds the 20MB maximum size limit.');
            return;
        }

        // Validate Type (basic check)
        const fileExt = file.name.split('.').pop().toLowerCase();
        const validExts = ['pdf', 'docx', 'pptx', 'zip'];
        if (!validExts.includes(fileExt) && !ALLOWED_TYPES.includes(file.type)) {
            showFileError('Invalid file type. Please upload a PDF, DOCX, PPTX, or ZIP.');
            return;
        }

        currentFile = file;
        
        // Auto-fill title if empty
        if (!resourceTitle.value) {
            // Remove extension and replace underscores with spaces
            let formattedTitle = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
            resourceTitle.value = formattedTitle;
        }

        // Update UI
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = formatBytes(file.size);
        dropZone.classList.add('hidden');
        filePreview.classList.remove('hidden');
        
        checkFormValidity();
    }

    function showFileError(msg) {
        fileError.textContent = msg;
        fileError.style.display = 'block';
        fileInput.value = '';
        currentFile = null;
    }

    removeFileBtn.addEventListener('click', () => {
        fileInput.value = '';
        currentFile = null;
        dropZone.classList.remove('hidden');
        filePreview.classList.add('hidden');
        checkFormValidity();
    });

    // --- 3. Form Validation Logic ---
    function checkFormValidity() {
        let isValid = currentFile !== null;
        
        requiredInputs.forEach(input => {
            if (input.type !== 'file' && !input.value.trim()) {
                isValid = false;
            }
        });

        submitBtn.disabled = !isValid;
    }

    // Add inline validation listeners
    requiredInputs.forEach(input => {
        if(input.type !== 'file') {
            input.addEventListener('input', () => {
                // Remove error styling on typing
                input.closest('.input-group').classList.remove('invalid');
                checkFormValidity();
            });
            input.addEventListener('blur', () => {
                if(!input.value.trim()) {
                    input.closest('.input-group').classList.add('invalid');
                }
            });
        }
    });

    // Description char count
    description.addEventListener('input', function() {
        charCount.textContent = this.value.length;
    });

    // --- 4. Submit & Mock Upload Process ---
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (submitBtn.disabled) return;

        // Transition to Uploading State
        switchState(stateForm, stateProgress);
        mockUploadProcess();
    });

    function mockUploadProcess() {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        let progress = 0;

        const interval = setInterval(() => {
            // Random chunk simulation
            progress += Math.floor(Math.random() * 15) + 5; 
            if (progress > 100) progress = 100;

            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${progress}%`;

            if (progress === 100) {
                clearInterval(interval);
                setTimeout(() => {
                    // Transition to Success State
                    switchState(stateProgress, stateSuccess);
                }, 500);
            }
        }, 300); // Update every 300ms
    }

    // --- 5. Reset Flow ---
    document.getElementById('uploadAnotherBtn').addEventListener('click', () => {
        form.reset();
        removeFileBtn.click(); // Clears file UI
        charCount.textContent = '0';
        document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
        
        // Reset Progress bar
        document.getElementById('progressBar').style.width = '0%';
        document.getElementById('progressText').textContent = '0%';
        
        switchState(stateSuccess, stateForm);
    });

    // --- Utilities ---
    function switchState(hideEl, showEl) {
        hideEl.classList.remove('active');
        hideEl.classList.add('hidden');
        showEl.classList.remove('hidden');
        // Small delay to allow display:block to apply before animating opacity
        setTimeout(() => showEl.classList.add('active'), 10);
    }

    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
});