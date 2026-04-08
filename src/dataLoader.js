const fs = require('fs-extra');
const csv = require('csv-parser');
const path = require('path');
const { generateTimeSlots } = require('./timeSlotGenerator');

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Parse rooms.csv
 * @returns {Promise<Array>} Array of room objects
 */
async function loadRooms() {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(path.join(DATA_DIR, 'rooms.csv'))
      .pipe(csv())
      .on('data', (row) => {
        // Parse equipment column as array (split by comma, trim whitespace)
        const equipment = row.equipment
          ? row.equipment.split(',').map(e => e.trim())
          : [];
        results.push({
          room_id: row.room_id,
          name: row.name,
          capacity: parseInt(row.capacity, 10),
          type: row.type,
          equipment
        });
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

/**
 * Parse faculty.csv
 * @returns {Promise<Array>} Array of faculty objects
 */
async function loadFaculty() {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(path.join(DATA_DIR, 'faculty.csv'))
      .pipe(csv())
      .on('data', (row) => {
        results.push({
          faculty_id: row.faculty_id,
          name: row.name,
          email: row.email,
          department: row.department
        });
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

/**
 * Parse students.csv and count students per section
 * @returns {Promise<Map<string, number>>} Map of section name to student count
 */
async function loadStudents() {
  return new Promise((resolve, reject) => {
    const sectionCounts = new Map();
    const studentsFilePath = path.join(DATA_DIR, 'students.csv');

    // Check if file exists
    fs.access(studentsFilePath, fs.constants.F_OK, (err) => {
      if (err) {
        // File doesn't exist, return empty map
        resolve(sectionCounts);
        return;
      }

      fs.createReadStream(studentsFilePath)
        .pipe(csv())
        .on('data', (row) => {
          const section = row.section;
          if (section) {
            sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1);
          }
        })
        .on('end', () => resolve(sectionCounts))
        .on('error', reject);
    });
  });
}

/**
 * Read time_slots.json config and generate time slots
 * @returns {Promise<Object>} { days, slots, breakSlots }
 */
async function loadTimeSlots() {
  const config = await fs.readJson(path.join(DATA_DIR, 'time_slots.json'));

  // Check if it's the new config format (has startTime) or old format (has slots array)
  if (config.startTime) {
    // New format: generate slots dynamically from config
    return generateTimeSlots(config);
  } else {
    // Legacy format: use hardcoded slots
    const slots = config.slots.filter(slot => !slot.is_break);
    const breakSlots = config.slots.filter(slot => slot.is_break === true);
    return {
      days: config.days,
      slots,
      breakSlots
    };
  }
}

/**
 * Parse a courses CSV file
 * @param {string} filename - Name of the CSV file in /data/
 * @returns {Promise<Array>} Array of course objects
 */
async function loadCourses(filename) {
  return new Promise((resolve, reject) => {
    const results = [];
    const filePath = path.join(DATA_DIR, filename);

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        // Parse room_requirements column as array (default to empty array if missing)
        const roomRequirements = row.room_requirements
          ? row.room_requirements.split(',').map(r => r.trim()).filter(r => r.length > 0)
          : [];
        results.push({
          course_code: row.course_code,
          name: row.name,
          faculty_id: row.faculty_id,
          L: parseInt(row.L, 10),
          T: parseInt(row.T, 10),
          P: parseInt(row.P, 10),
          S: parseInt(row.S, 10),
          C: parseInt(row.C, 10),
          section: row.section,
          is_elective: row.is_elective === 'true',
          section_strength: parseInt(row.section_strength, 10),
          room_requirements: roomRequirements
        });
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

/**
 * Load all course CSV files from /data/ directory
 * Scans all .csv files EXCEPT rooms.csv, faculty.csv, students.csv
 * Derives section name from filename (e.g., "CSEA-II.csv" -> "CSEA-II")
 * Cross-references with student counts to set section_strength
 * @returns {Promise<Array>} Flat array of all courses with section field
 */
async function loadAllCourses() {
  const files = await fs.readdir(DATA_DIR);

  // Filter: all .csv files EXCEPT rooms.csv, faculty.csv, students.csv
  const courseFiles = files.filter(f =>
    f.endsWith('.csv') &&
    !['rooms.csv', 'faculty.csv', 'students.csv'].includes(f)
  );

  // Load student counts for section_strength override
  const studentCounts = await loadStudents();

  const allCourses = [];
  for (const file of courseFiles) {
    const courses = await loadCourses(file);

    // Derive section name from filename if not already in CSV rows
    // e.g., "CSEA-II.csv" -> section "CSEA-II"
    // Handle both "courses_CSEA-II.csv" and "CSEA-II.csv" patterns
    let sectionFromFilename = file.replace('.csv', '');
    if (sectionFromFilename.startsWith('courses_')) {
      sectionFromFilename = sectionFromFilename.replace('courses_', '');
    }

    for (const course of courses) {
      // Inject section field if not present in the CSV row
      if (!course.section) {
        course.section = sectionFromFilename;
      }

      // Override section_strength from students.csv if available
      const studentCount = studentCounts.get(course.section);
      if (studentCount !== undefined) {
        course.section_strength = studentCount;
      } else if (!course.section_strength || course.section_strength <= 0) {
        // Default to 60 if no student data and no section_strength
        course.section_strength = 60;
        console.warn(`WARNING: Section ${course.section} not found in students.csv, defaulting section_strength to 60`);
      }

      allCourses.push(course);
    }
  }
  return allCourses;
}

module.exports = {
  loadRooms,
  loadFaculty,
  loadTimeSlots,
  loadCourses,
  loadAllCourses,
  loadStudents
};
