/**
 * Timetable Generator - Frontend Application
 */

// DOM Elements
const uploadBtn = document.getElementById('upload-btn');
const generateTimetableBtn = document.getElementById('generate-timetable-btn');
const generateExamBtn = document.getElementById('generate-exam-btn');
const generateFacultyBtn = document.getElementById('generate-faculty-btn');
const validateBtn = document.getElementById('validate-btn');
const examStartDate = document.getElementById('exam-start-date');

const fileList = document.getElementById('file-list');
const resultsContainer = document.getElementById('results-container');
const validationContainer = document.getElementById('validation-container');
const healthStatus = document.getElementById('health-status');

// Time Slot Settings Elements
const previewTimeslotsBtn = document.getElementById('preview-timeslots-btn');
const saveTimeslotsBtn = document.getElementById('save-timeslots-btn');
const timeslotsPreview = document.getElementById('timeslots-preview');

const spinners = {
  timetable: document.getElementById('timetable-spinner'),
  exam: document.getElementById('exam-spinner'),
  faculty: document.getElementById('faculty-spinner')
};

// Set default exam start date to next Monday
function setDefaultExamDate() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 + 1;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilMonday);
  examStartDate.value = nextMonday.toISOString().split('T')[0];
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setDefaultExamDate();
  checkHealth();
  loadFileList();
});

// ========== Health Check ==========

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();

    if (data.status === 'ok') {
      showHealthStatus('Server ready - ' + data.dataFiles + ' data files, ' + data.outputFiles + ' output files', 'success');
    } else {
      showHealthStatus('Server status: ' + data.status, 'error');
    }
  } catch (error) {
    showHealthStatus('Server unreachable: ' + error.message, 'error');
  }
}

function showHealthStatus(message, type) {
  if (!healthStatus) {
    // Create status bar if it doesn't exist
    const statusBar = document.createElement('div');
    statusBar.id = 'health-status';
    statusBar.className = type === 'success' ? 'status-bar status-success' : 'status-bar status-error';
    statusBar.innerHTML = '<span class="status-message">' + message + '</span>';
    document.body.insertBefore(statusBar, document.body.firstChild);
  } else {
    healthStatus.className = 'status-bar ' + (type === 'success' ? 'status-success' : 'status-error');
    healthStatus.innerHTML = '<span class="status-message">' + message + '</span>';
    healthStatus.style.display = 'block';
  }
}

// ========== Upload Functions ==========

uploadBtn.addEventListener('click', uploadFiles);

async function uploadFiles() {
  const roomsFile = document.getElementById('rooms-file').files[0];
  const facultyFile = document.getElementById('faculty-file').files[0];
  const timeSlotsFile = document.getElementById('time-slots-file').files[0];
  const coursesFiles = document.getElementById('courses-files').files;

  if (!roomsFile && !facultyFile && !timeSlotsFile && coursesFiles.length === 0) {
    showResult('Please select at least one file to upload.', 'error');
    return;
  }

  const formData = new FormData();
  if (roomsFile) formData.append('rooms', roomsFile);
  if (facultyFile) formData.append('faculty', facultyFile);
  if (timeSlotsFile) formData.append('time_slots', timeSlotsFile);
  for (const file of coursesFiles) {
    formData.append('courses', file);
  }

  setLoading(true);

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      // Extract section names from uploaded course files
      const sections = extractSectionsFromFiles(coursesFiles);

      let message = `Successfully uploaded ${data.uploadedFiles.length} file(s).`;
      if (sections.length > 0) {
        message += ` ${sections.length} section(s) detected: ${sections.join(', ')}`;
        displaySectionTags(sections);
      }

      showResult(message, 'success');
      loadFileList();
      // Reset file inputs
      document.getElementById('rooms-file').value = '';
      document.getElementById('faculty-file').value = '';
      document.getElementById('time-slots-file').value = '';
      document.getElementById('courses-files').value = '';
    } else {
      showResult(`Upload failed: ${data.error}`, 'error');
    }
  } catch (error) {
    showResult(`Upload failed: ${error.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

/**
 * Extract section names from uploaded course CSV files
 * @param {FileList} files - FileList from file input
 * @returns {string[]} Array of section names
 */
function extractSectionsFromFiles(files) {
  const sections = [];
  for (const file of files) {
    let sectionName = file.name.replace('.csv', '');
    if (sectionName.startsWith('courses_')) {
      sectionName = sectionName.replace('courses_', '');
    }
    sections.push(sectionName);
  }
  return sections.sort();
}

/**
 * Display section tags/chips in the upload section
 * @param {string[]} sections - Array of section names
 */
function displaySectionTags(sections) {
  const uploadSection = document.getElementById('upload-section');
  let tagsContainer = uploadSection.querySelector('.section-tags');

  if (!tagsContainer) {
    tagsContainer = document.createElement('div');
    tagsContainer.className = 'section-tags';
    tagsContainer.innerHTML = '<h4>Detected Sections</h4><div class="tags-list"></div>';
    uploadSection.querySelector('.upload-form').insertAdjacentElement('afterend', tagsContainer);
  }

  const tagsList = tagsContainer.querySelector('.tags-list');
  tagsList.innerHTML = sections.map(section => `
    <span class="tag-chip">${section}</span>
  `).join('');
}

async function loadFileList() {
  try {
    const response = await fetch('/api/files');
    const files = await response.json();

    if (files.length === 0) {
      fileList.innerHTML = '<p class="file-item">No files uploaded yet.</p>';
      return;
    }

    fileList.innerHTML = files.map(file => `
      <div class="file-item">
        <div class="file-info">
          <span class="file-name">${file.name}</span>
          <span class="file-meta">${formatFileSize(file.size)} • Modified: ${formatDate(file.modified)}</span>
        </div>
        <button class="btn btn-danger" onclick="deleteFile('${file.name}')">Delete</button>
      </div>
    `).join('');
  } catch (error) {
    fileList.innerHTML = `<p class="file-item">Error loading files: ${error.message}</p>`;
  }
}

async function deleteFile(filename) {
  if (!confirm(`Are you sure you want to delete ${filename}?`)) return;

  try {
    const response = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      showResult(`File ${filename} deleted successfully.`, 'success');
      loadFileList();
    } else {
      showResult(`Delete failed: ${data.error}`, 'error');
    }
  } catch (error) {
    showResult(`Delete failed: ${error.message}`, 'error');
  }
}

// ========== Generate Functions ==========

generateTimetableBtn.addEventListener('click', generateTimetable);
generateExamBtn.addEventListener('click', generateExam);
generateFacultyBtn.addEventListener('click', generateFaculty);

async function generateTimetable() {
  setSpinner('timetable', true);

  try {
    const response = await fetch('/api/generate/timetable', {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      let message = `Generated ${data.conflicts.length === 0 ? 'valid' : 'invalid'} timetable with ${data.missingHours.length} missing hour entries.`;
      if (data.conflicts.length > 0) {
        message += ` ${data.conflicts.length} conflicts detected.`;
      }
      showResult(message, data.conflicts.length === 0 ? 'success' : 'warning');
      showDownloadButton(data.file);

      // Enable faculty timetable button
      generateFacultyBtn.disabled = false;

      // Auto-refresh file list
      loadFileList();
    } else {
      showResult(`Generation failed: ${data.error}`, 'error');
    }
  } catch (error) {
    showResult(`Generation failed: ${error.message}`, 'error');
  } finally {
    setSpinner('timetable', false);
  }
}

async function generateExam() {
  setSpinner('exam', true);

  try {
    const response = await fetch('/api/generate/exam', {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      let message = 'Exam schedule generated successfully.';
      if (data.conflicts.length > 0) {
        message += ` ${data.conflicts.length} conflicts detected.`;
        showResult(message, 'warning');
      } else {
        showResult(message, 'success');
      }
      showDownloadButton(data.file);

      // Auto-refresh file list
      loadFileList();
    } else {
      showResult(`Generation failed: ${data.error}`, 'error');
    }
  } catch (error) {
    showResult(`Generation failed: ${error.message}`, 'error');
  } finally {
    setSpinner('exam', false);
  }
}

async function generateFaculty() {
  setSpinner('faculty', true);

  try {
    const response = await fetch('/api/generate/faculty', {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      showResult(`Generated faculty timetables for ${data.facultyCount} faculty members.`, 'success');
      showDownloadButton(data.file);

      // Auto-refresh file list
      loadFileList();
    } else {
      showResult(`Generation failed: ${data.error}`, 'error');
    }
  } catch (error) {
    showResult(`Generation failed: ${error.message}`, 'error');
  } finally {
    setSpinner('faculty', false);
  }
}

// ========== Validation Functions ==========

validateBtn.addEventListener('click', runValidation);

async function runValidation() {
  setLoading(true);

  try {
    const response = await fetch('/api/validate');
    const data = await response.json();

    if (data.validation) {
      displayValidationResults(data.validation, data.roomUtilization);
    } else {
      showResult('Validation failed to run.', 'error');
    }
  } catch (error) {
    showResult(`Validation failed: ${error.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function displayValidationResults(validation, roomUtilization) {
  const { conflicts, missingHours, valid } = validation;

  let html = '<h3>Validation Results</h3>';
  html += '<table class="validation-table">';
  html += '<thead><tr><th>Type</th><th>Description</th><th>Affected</th></tr></thead>';
  html += '<tbody>';

  if (conflicts.length === 0 && missingHours.length === 0) {
    html += '<tr class="ok">';
    html += '<td><span class="type-badge ok">OK</span></td>';
    html += '<td>No conflicts or missing hours detected</td>';
    html += '<td>-</td>';
    html += '</tr>';
  }

  // Add conflicts
  for (const conflict of conflicts) {
    html += '<tr class="conflict">';
    html += `<td><span class="type-badge conflict">${formatConflictType(conflict.type)}</span></td>`;
    html += `<td>${conflict.description}</td>`;
    html += `<td>${JSON.stringify(conflict.affected)}</td>`;
    html += '</tr>';
  }

  // Add missing hours
  for (const missing of missingHours) {
    html += '<tr class="warning">';
    html += `<td><span class="type-badge warning">MISSING HOURS</span></td>`;
    html += `<td>${missing.course_code} (${missing.section}): ${missing.type} - required ${missing.required}, allocated ${missing.allocated}</td>`;
    html += '<td>-</td>';
    html += '</tr>';
  }

  html += '</tbody></table>';

  // Add room utilization summary
  if (roomUtilization && roomUtilization.length > 0) {
    html += '<h3>Room Utilization Summary</h3>';
    html += '<table class="utilization-table">';
    html += '<thead><tr><th>Room</th><th>Total Sessions</th><th>Avg Occupancy %</th></tr></thead>';
    html += '<tbody>';

    for (const room of roomUtilization) {
      const occupancyClass = room.avgOccupancy > 60 ? 'high' :
                             room.avgOccupancy >= 40 ? 'medium' : 'low';
      html += `<tr class="utilization-${occupancyClass}">`;
      html += `<td>${room.room_name} (${room.capacity})</td>`;
      html += `<td>${room.totalSessions}</td>`;
      html += `<td><span class="occupancy-badge ${occupancyClass}">${room.avgOccupancy}%</span></td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';
  }

  validationContainer.innerHTML = html;
}

// ========== UI Helper Functions ==========

function showResult(message, type) {
  const className = type === 'success' ? 'result-success' :
                    type === 'error' ? 'result-error' : 'result-info';

  resultsContainer.innerHTML = `
    <div class="result-box ${className}">
      <h4>${type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Notice'}</h4>
      <p>${message}</p>
    </div>
  `;
}

function showDownloadButton(filePath) {
  const filename = filePath.split('/').pop();
  const downloadHtml = `
    <a href="/api/download/${encodeURIComponent(filename)}" class="download-btn" download>
      Download Excel File
    </a>
  `;
  resultsContainer.insertAdjacentHTML('beforeend', downloadHtml);
}

function setSpinner(type, show) {
  spinners[type].style.display = show ? 'block' : 'none';
  if (type === 'timetable') generateTimetableBtn.disabled = show;
  if (type === 'exam') generateExamBtn.disabled = show;
  if (type === 'faculty') generateFacultyBtn.disabled = show;
}

function setLoading(loading) {
  uploadBtn.disabled = loading;
  validateBtn.disabled = loading;
  if (loading) {
    document.body.classList.add('loading');
  } else {
    document.body.classList.remove('loading');
  }
}

// ========== Utility Functions ==========

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function formatConflictType(type) {
  return type.replace(/_/g, ' ');
}

// ========== Time Slot Settings ==========

previewTimeslotsBtn.addEventListener('click', previewTimeSlots);
saveTimeslotsBtn.addEventListener('click', saveTimeSlotsConfig);

async function previewTimeSlots() {
  const config = getTimeSlotsConfig();

  try {
    const response = await fetch('/api/timeslots/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    const data = await response.json();

    if (data.slots) {
      displayTimeSlotsPreview(data.slots, data.breakSlots);
    } else {
      showResult('Preview failed: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    showResult('Preview failed: ' + error.message, 'error');
  }
}

async function saveTimeSlotsConfig() {
  const config = getTimeSlotsConfig();

  try {
    const response = await fetch('/api/timeslots/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    const data = await response.json();

    if (data.success) {
      showResult('Time slot configuration saved successfully.', 'success');
      // Refresh file list to show updated config
      loadFileList();
    } else {
      showResult('Save failed: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    showResult('Save failed: ' + error.message, 'error');
  }
}

function getTimeSlotsConfig() {
  return {
    startTime: document.getElementById('ts-start-time').value,
    endTime: document.getElementById('ts-end-time').value,
    periodDuration: parseInt(document.getElementById('ts-period-duration').value, 10),
    breakAfterPeriod: parseInt(document.getElementById('ts-break-after').value, 10),
    lunchDuration: parseInt(document.getElementById('ts-lunch-duration').value, 10),
    shortBreakDuration: parseInt(document.getElementById('ts-short-break').value, 10)
  };
}

function displayTimeSlotsPreview(slots, breakSlots) {
  if (!slots || slots.length === 0) {
    timeslotsPreview.innerHTML = '<p class="text-muted">No slots generated. Check your configuration.</p>';
    return;
  }

  let html = '<table class="timeslots-table"><thead><tr>';
  html += '<th>ID</th><th>Label</th><th>Start</th><th>End</th><th>Type</th>';
  html += '</tr></thead><tbody>';

  for (const slot of slots) {
    const isBreak = breakSlots.includes(slot.id);
    html += `<tr class="${isBreak ? 'break-row' : ''}">`;
    html += `<td>${slot.id}</td>`;
    html += `<td>${slot.label}</td>`;
    html += `<td>${slot.start || '-'}</td>`;
    html += `<td>${slot.end || '-'}</td>`;
    html += `<td><span class="type-badge ${isBreak ? 'warning' : 'ok'}">${isBreak ? 'Break' : 'Class'}</span></td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  timeslotsPreview.innerHTML = html;
}
