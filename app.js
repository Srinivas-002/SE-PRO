const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const { loadRooms, loadFaculty, loadTimeSlots, loadAllCourses } = require('./src/dataLoader');
const { generateTimetable } = require('./src/timetable');
const { validateTimetable, validateExamSchedule } = require('./src/validator');
const { exportTimetable } = require('./src/exportTimetable');
const { generateExamSchedule } = require('./src/exam');
const { exportExamSchedule } = require('./src/exportExam');
const { extractFacultyTimetables } = require('./src/faculty');
const { exportFacultyTimetables } = require('./src/exportFaculty');
const { generateTimeSlots } = require('./src/timeSlotGenerator');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');

// Ensure directories exist
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(OUTPUTS_DIR);

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// JSON body parser
app.use(express.json());

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DATA_DIR);
  },
  filename: (req, file, cb) => {
    // Custom filename logic handled in route
    cb(null, file.originalname);
  }
});

// File filter for CSV and JSON
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.csv', '.json'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${ext}. Only .csv and .json files are allowed.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.get('/', (req, res) => {
  res.send('Server is running!');
});

// GET /api/data - Returns all loaded data
app.get('/api/data', async (req, res) => {
  try {
    const [rooms, faculty, timeSlots, courses] = await Promise.all([
      loadRooms(),
      loadFaculty(),
      loadTimeSlots(),
      loadAllCourses()
    ]);

    res.json({
      rooms,
      faculty,
      timeSlots,
      courses
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/validate - Generates and validates timetable
app.get('/api/validate', async (req, res) => {
  try {
    const [rooms, faculty, timeSlots, courses] = await Promise.all([
      loadRooms(),
      loadFaculty(),
      loadTimeSlots(),
      loadAllCourses()
    ]);

    const timetable = generateTimetable(courses, rooms, timeSlots);
    const validation = validateTimetable(timetable, courses);

    // Calculate room utilization
    const roomUtilization = calculateRoomUtilization(timetable, rooms);

    res.json({
      timetable,
      validation,
      summary: {
        totalEntries: timetable.length,
        totalConflicts: validation.conflicts.length,
        totalMissingHours: validation.missingHours.length,
        isValid: validation.valid
      },
      roomUtilization
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Calculate room utilization from timetable entries
 * @param {Array} timetable - Timetable entries
 * @param {Array} rooms - Array of rooms
 * @returns {Array} Room utilization data
 */
function calculateRoomUtilization(timetable, rooms) {
  const roomStats = new Map();

  // Initialize stats for all rooms
  for (const room of rooms) {
    roomStats.set(room.room_id, {
      room_id: room.room_id,
      room_name: room.name,
      capacity: room.capacity,
      totalSessions: 0,
      totalStudents: 0
    });
  }

  // Count sessions and students per room
  for (const entry of timetable) {
    const stats = roomStats.get(entry.room_id);
    if (stats) {
      stats.totalSessions++;
      // Estimate students based on section strength (approximate)
      stats.totalStudents += entry.room_capacity || 0;
    }
  }

  // Calculate utilization percentage
  const utilization = [];
  for (const [roomId, stats] of roomStats) {
    // Utilization = (total students / (capacity * sessions)) * 100
    // But since we're tracking actual usage, use: (sessions using room / max possible sessions) * 100
    // For simplicity: avg occupancy % = (avg students per session / capacity) * 100
    const avgOccupancy = stats.totalSessions > 0
      ? Math.round((stats.totalStudents / (stats.totalSessions * stats.capacity)) * 100)
      : 0;

    utilization.push({
      room_id: stats.room_id,
      room_name: stats.room_name,
      capacity: stats.capacity,
      totalSessions: stats.totalSessions,
      avgOccupancy: Math.min(avgOccupancy, 100) // Cap at 100%
    });
  }

  // Sort by total sessions (most used first)
  return utilization.sort((a, b) => b.totalSessions - a.totalSessions);
}

// POST /api/generate/timetable - Generate, validate, and export timetable
app.post('/api/generate/timetable', async (req, res) => {
  try {
    const [rooms, faculty, timeSlots, courses] = await Promise.all([
      loadRooms(),
      loadFaculty(),
      loadTimeSlots(),
      loadAllCourses()
    ]);

    // Get unique sections and log
    const sections = [...new Set(courses.map(c => c.section))].sort();
    console.log(`Loaded ${sections.length} sections: [${sections.join(', ')}]`);

    const timetable = generateTimetable(courses, rooms, timeSlots);
    const validation = validateTimetable(timetable, courses);

    const outputPath = path.join(__dirname, 'outputs', 'Timetable.xlsx');
    await exportTimetable(timetable, timeSlots, outputPath);

    res.json({
      success: true,
      conflicts: validation.conflicts,
      missingHours: validation.missingHours,
      sectionCount: sections.length,
      sections: sections,
      file: outputPath
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/generate/exam - Generate, validate, and export exam schedule
app.post('/api/generate/exam', async (req, res) => {
  try {
    const [rooms, faculty, timeSlots, courses] = await Promise.all([
      loadRooms(),
      loadFaculty(),
      loadTimeSlots(),
      loadAllCourses()
    ]);

    const config = {
      startDate: '2025-11-01',
      daysAvailable: 14,
      slotsPerDay: 2
    };

    const examSchedule = generateExamSchedule(courses, rooms, config);
    const validation = validateExamSchedule(examSchedule);

    const outputPath = path.join(__dirname, 'outputs', 'ExamSchedule.xlsx');
    await exportExamSchedule(examSchedule, outputPath);

    res.json({
      success: true,
      conflicts: validation.conflicts,
      file: outputPath
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/generate/faculty - Generate and export faculty timetables
app.post('/api/generate/faculty', async (req, res) => {
  try {
    const [rooms, faculty, timeSlots, courses] = await Promise.all([
      loadRooms(),
      loadFaculty(),
      loadTimeSlots(),
      loadAllCourses()
    ]);

    const timetable = generateTimetable(courses, rooms, timeSlots);
    const facultyMap = extractFacultyTimetables(timetable, faculty);

    const outputPath = path.join(__dirname, 'outputs', 'FacultyTimetable.xlsx');
    await exportFacultyTimetables(facultyMap, timeSlots, outputPath);

    res.json({
      success: true,
      facultyCount: facultyMap.size,
      file: outputPath
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/upload - Upload data files
app.post('/api/upload', upload.fields([
  { name: 'rooms', maxCount: 1 },
  { name: 'faculty', maxCount: 1 },
  { name: 'time_slots', maxCount: 1 },
  { name: 'courses', maxCount: 10 }
]), async (req, res) => {
  try {
    const uploadedFiles = [];

    // Process rooms file
    if (req.files.rooms && req.files.rooms[0]) {
      const src = req.files.rooms[0].path;
      const dest = path.join(DATA_DIR, 'rooms.csv');
      await fs.move(src, dest, { overwrite: true });
      uploadedFiles.push({ name: 'rooms.csv', size: req.files.rooms[0].size });
    }

    // Process faculty file
    if (req.files.faculty && req.files.faculty[0]) {
      const src = req.files.faculty[0].path;
      const dest = path.join(DATA_DIR, 'faculty.csv');
      await fs.move(src, dest, { overwrite: true });
      uploadedFiles.push({ name: 'faculty.csv', size: req.files.faculty[0].size });
    }

    // Process time_slots file
    if (req.files.time_slots && req.files.time_slots[0]) {
      const src = req.files.time_slots[0].path;
      const dest = path.join(DATA_DIR, 'time_slots.json');
      await fs.move(src, dest, { overwrite: true });
      uploadedFiles.push({ name: 'time_slots.json', size: req.files.time_slots[0].size });
    }

    // Process courses files
    if (req.files.courses) {
      for (const file of req.files.courses) {
        // Extract base name without extension
        const baseName = path.basename(file.originalname, path.extname(file.originalname));
        const ext = path.extname(file.originalname);
        const newFileName = `courses_${baseName}${ext}`;
        const src = file.path;
        const dest = path.join(DATA_DIR, newFileName);
        await fs.move(src, dest, { overwrite: true });
        uploadedFiles.push({ name: newFileName, size: file.size });
      }
    }

    res.json({
      success: true,
      uploadedFiles
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/files - List all files in /data/
app.get('/api/files', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const fileInfos = [];

    for (const file of files) {
      const filePath = path.join(DATA_DIR, file);
      const stats = await fs.stat(filePath);
      fileInfos.push({
        name: file,
        size: stats.size,
        modified: stats.mtime,
        isDirectory: stats.isDirectory()
      });
    }

    res.json(fileInfos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/files/:filename - Delete a file from /data/
app.delete('/api/files/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;

    // Protect against path traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename. Path traversal not allowed.' });
    }

    const filePath = path.join(DATA_DIR, filename);

    // Ensure the file is within DATA_DIR
    const resolvedPath = path.resolve(filePath);
    const resolvedDataDir = path.resolve(DATA_DIR);
    if (!resolvedPath.startsWith(resolvedDataDir)) {
      return res.status(400).json({ error: 'Invalid file path.' });
    }

    await fs.remove(filePath);
    res.json({ success: true, deleted: filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/download/:filename - Download file from /outputs/
app.get('/api/download/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;

    // Only allow .xlsx files
    if (!filename.endsWith('.xlsx')) {
      return res.status(400).json({ error: 'Only .xlsx files can be downloaded.' });
    }

    // Protect against path traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename. Path traversal not allowed.' });
    }

    const filePath = path.join(OUTPUTS_DIR, filename);

    // Ensure the file is within OUTPUTS_DIR
    const resolvedPath = path.resolve(filePath);
    const resolvedOutputsDir = path.resolve(OUTPUTS_DIR);
    if (!resolvedPath.startsWith(resolvedOutputsDir)) {
      return res.status(400).json({ error: 'Invalid file path.' });
    }

    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found.' });
    }

    res.download(filePath, filename);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/health - Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const [dataFiles, outputFiles] = await Promise.all([
      fs.readdir(DATA_DIR),
      fs.readdir(OUTPUTS_DIR)
    ]);

    res.json({
      status: 'ok',
      dataFiles: dataFiles.length,
      outputFiles: outputFiles.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// POST /api/timeslots/preview - Generate time slots preview from config
app.post('/api/timeslots/preview', (req, res) => {
  try {
    const config = req.body;
    const result = generateTimeSlots(config);
    res.json({ slots: result.slots, breakSlots: result.breakSlots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/timeslots/save - Save time slot config
app.post('/api/timeslots/save', async (req, res) => {
  try {
    const config = req.body;
    const configPath = path.join(DATA_DIR, 'time_slots.json');

    await fs.writeJson(configPath, config, { spaces: 2 });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
