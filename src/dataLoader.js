const fs = require('fs-extra');
const csv = require('csv-parser');
const path = require('path');
const { generateTimeSlots } = require('./timeSlotGenerator');

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Parse faculty.csv
 * Returns { list, byId, byName }
 * - byId: Map<Faculty_ID, { id, name }>
 * - byName: Map<normalized_name, Faculty_ID> (lowercase, trimmed)
 */
async function loadFaculty() {
  return new Promise((resolve, reject) => {
    const list = [];
    const byId = new Map();
    const byName = new Map();

    fs.createReadStream(path.join(DATA_DIR, 'faculty.csv'))
      .pipe(csv())
      .on('data', (row) => {
        const faculty = {
          id: row.Faculty_ID,
          name: row.Name
        };
        list.push(faculty);
        byId.set(faculty.id, faculty);
        // Normalize name for lookup: lowercase, trim
        const normalizedName = faculty.name.toLowerCase().trim();
        byName.set(normalizedName, faculty.id);
      })
      .on('end', () => resolve({ list, byId, byName }))
      .on('error', reject);
  });
}

/**
 * Parse rooms.csv
 * Returns array of { room_id, capacity, type, facilities: [] }
 * Facilities: split by comma, trim each item
 */
async function loadRooms() {
  return new Promise((resolve, reject) => {
    const results = [];

    fs.createReadStream(path.join(DATA_DIR, 'rooms.csv'))
      .pipe(csv())
      .on('data', (row) => {
        // Parse Facilities column: split by comma, trim each item
        const facilities = row.Facilities
          ? row.Facilities.split(',').map(f => f.trim()).filter(f => f.length > 0)
          : [];

        results.push({
          room_id: row.Room_ID,
          capacity: parseInt(row.Capacity, 10),
          type: row.Type,
          facilities
        });
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

/**
 * Parse a courses CSV file
 * @param {string} filename - Name of the CSV file in /data/
 * @param {Object} facultyByName - Map of normalized faculty name -> faculty_id
 * @returns {Promise<Array>} Array of course objects
 */
async function loadCourses(filename, facultyByName) {
  return new Promise((resolve, reject) => {
    const results = [];
    const filePath = path.join(DATA_DIR, filename);

    // Derive section from filename: "courses_CSEA-II.csv" or "CSEA-II.csv" -> "CSEA-II"
    let section = filename.replace('.csv', '');
    if (section.startsWith('courses_')) {
      section = section.replace('courses_', '');
    }

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        // Parse L-T-P-S-C column: split by hyphen
        const ltps = row['L-T-P-S-C'].split('-').map(n => parseInt(n.trim(), 10));
        const [L, T, P, S, C] = ltps;

        // Parse faculty name(s) - may contain " & " for co-teaching
        const facultyNameRaw = row.Faculty || '';
        const facultyNames = facultyNameRaw.split(' & ').map(n => n.trim());

        // Look up each faculty name in the byName map
        const facultyIds = [];
        const unresolvedNames = [];
        for (const name of facultyNames) {
          const normalizedName = name.toLowerCase().trim();
          let facultyId = facultyByName.get(normalizedName);

          // If no exact match, try partial matching
          if (!facultyId) {
            // Extract last name (last word) for matching
            const nameParts = normalizedName.split(/\s+/);
            const lastName = nameParts[nameParts.length - 1];
            const firstName = nameParts[0];

            // Try matching by last name + first initial
            for (const [fname, fid] of facultyByName) {
              const fnameParts = fname.split(/\s+/);
              const flast = fnameParts[fnameParts.length - 1];

              // Match if last names match and first letter matches
              if (flast === lastName && fnameParts[0].startsWith(firstName[0])) {
                facultyId = fid;
                break;
              }
            }
          }

          if (facultyId) {
            facultyIds.push(facultyId);
          } else {
            unresolvedNames.push(name);
          }
        }

        // Parse other fields with defaults for missing columns
        const isCombined = row.Is_Combined !== undefined ? parseInt(row.Is_Combined, 10) : 0;
        const semesterHalf = row.Semester_Half !== undefined ? parseInt(row.Semester_Half, 10) : 0;
        const elective = row.Elective !== undefined ? parseInt(row.Elective, 10) : 0;
        const studentsEnrolled = row.Students !== undefined ? parseInt(row.Students, 10) : 0;
        const basket = row.ElectiveBasket !== undefined ? parseInt(row.ElectiveBasket, 10) : 0;

        results.push({
          course_code: row.Course_Code,
          course_title: row.Course_Title,
          name: row.Course_Title, // Alias for backward compatibility
          L, T, P, S, C,
          faculty_ids: facultyIds,
          faculty_id: facultyIds.length > 0 ? facultyIds[0] : null, // Alias for backward compatibility
          faculty_name_raw: unresolvedNames.length > 0 ? unresolvedNames.join(' & ') : null,
          is_combined: isCombined,
          semester_half: semesterHalf,
          is_elective: elective === 1, // Alias for backward compatibility
          elective: elective,
          students_enrolled: studentsEnrolled,
          section_strength: studentsEnrolled, // Alias for backward compatibility
          basket: basket,
          section: section
        });
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

/**
 * Load all course CSV files from /data/
 * Scans all .csv files EXCEPT rooms.csv, faculty.csv, students.csv
 * @returns {Promise<Array>} Flat array of all courses
 */
async function loadAllCourses() {
  // First load faculty to get the name->id mapping
  const faculty = await loadFaculty();
  const facultyByName = faculty.byName;

  const files = await fs.readdir(DATA_DIR);

  // Filter: all .csv files EXCEPT rooms.csv, faculty.csv, students.csv
  const courseFiles = files.filter(f =>
    f.endsWith('.csv') &&
    !['rooms.csv', 'faculty.csv', 'students.csv'].includes(f)
  );

  const allCourses = [];
  for (const file of courseFiles) {
    const courses = await loadCourses(file, facultyByName);
    allCourses.push(...courses);
  }

  console.log(`Loaded ${allCourses.length} courses from ${courseFiles.length} section files`);

  // Log any courses with unresolved faculty names
  const unresolved = allCourses.filter(c => c.faculty_name_raw);
  if (unresolved.length > 0) {
    console.warn(`WARNING: ${unresolved.length} courses have unresolved faculty names:`);
    unresolved.forEach(c => {
      console.warn(`  - ${c.course_code}: "${c.faculty_name_raw}"`);
    });
  }

  return allCourses;
}

/**
 * Parse students.csv
 * Returns Map<Group, { count, courseSet: Set<course_codes> }>
 * Group = section name like "CSEA-1", "ECE-V"
 * Courses = semicolon-separated list of course codes
 */
async function loadStudents() {
  return new Promise((resolve, reject) => {
    const groupMap = new Map();

    fs.createReadStream(path.join(DATA_DIR, 'students.csv'))
      .pipe(csv())
      .on('data', (row) => {
        const group = row.Group;
        const courses = row.Courses ? row.Courses.split(';').map(c => c.trim()) : [];

        if (!groupMap.has(group)) {
          groupMap.set(group, { count: 0, courseSet: new Set() });
        }
        const groupData = groupMap.get(group);
        groupData.count++;
        courses.forEach(c => groupData.courseSet.add(c));
      })
      .on('end', () => resolve(groupMap))
      .on('error', reject);
  });
}

/**
 * Read time_slots.json config
 * @returns {Promise<Object>} { days, slots, breakSlots } or generated slots
 */
async function loadTimeSlots() {
  const config = await fs.readJson(path.join(DATA_DIR, 'time_slots.json'));

  // Check if it's the new config format (has startTime) or old format (has slots array)
  if (config.startTime) {
    // New format: generate slots dynamically from config
    return generateTimeSlots(config);
  } else if (config.time_slots) {
    // Current format: time_slots array without break flags
    // Add id, duration, label fields to each slot
    const { timeToMinutes } = require('./timeSlotGenerator');
    let slotId = 1;
    const slots = config.time_slots
      .filter(slot => !slot.is_break)
      .map(slot => {
        const duration = timeToMinutes(slot.end) - timeToMinutes(slot.start);
        return {
          id: slotId++,
          label: `${slot.start}-${slot.end}`,
          start: slot.start,
          end: slot.end,
          duration,
          is_break: false
        };
      });
    const breakSlots = config.time_slots
      .filter(slot => slot.is_break === true)
      .map(slot => ({
        ...slot,
        id: slotId++,
        is_break: true
      }));
    return {
      days: config.days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      slots,
      breakSlots
    };
  } else if (config.slots) {
    // Legacy format: use hardcoded slots
    const slots = config.slots.filter(slot => !slot.is_break);
    const breakSlots = config.slots.filter(slot => slot.is_break === true);
    return {
      days: config.days,
      slots,
      breakSlots
    };
  } else {
    // Minimal config: use defaults
    return generateTimeSlots({});
  }
}

module.exports = {
  loadFaculty,
  loadRooms,
  loadCourses,
  loadAllCourses,
  loadStudents,
  loadTimeSlots
};
