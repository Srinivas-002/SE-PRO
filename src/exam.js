/**
 * exam.js - Exam scheduling algorithm
 */

/**
 * Generate exam schedule
 * @param {Array} courses - All courses from dataLoader
 * @param {Array} rooms - All rooms from dataLoader
 * @param {Object} config - { startDate, daysAvailable, slotsPerDay }
 * @returns {Array} Array of exam entries
 */
function generateExamSchedule(courses, rooms, config) {
  const { startDate, daysAvailable, slotsPerDay } = config;

  // Filter out labs - only use classrooms and halls for exams
  const examRooms = rooms.filter(r => r.type !== 'lab');

  // Validate daysAvailable is sufficient for number of courses
  const uniqueCourses = new Set(courses.map(c => c.course_code));
  const maxExamsPerDay = 4; // Hard limit in scheduling logic
  const minDaysNeeded = Math.ceil(uniqueCourses.size / maxExamsPerDay);

  if (daysAvailable < minDaysNeeded) {
    throw new Error(`Need at least ${minDaysNeeded} days to schedule ${uniqueCourses.size} exams (max 4 exams/day)`);
  }

  // Sort rooms by capacity (smaller first for efficiency)
  examRooms.sort((a, b) => a.capacity - b.capacity);

  // Get unique courses (group by course_code for electives)
  const courseMap = new Map();
  for (const course of courses) {
    if (!courseMap.has(course.course_code)) {
      courseMap.set(course.course_code, {
        course_code: course.course_code,
        course_name: course.name,
        sections: [],
        is_elective: course.is_elective,
        totalStudents: 0
      });
    }
    const entry = courseMap.get(course.course_code);
    entry.sections.push({
      section: course.section,
      section_strength: course.section_strength,
      faculty_id: course.faculty_id
    });
    entry.totalStudents += course.section_strength;
  }

  // Separate elective and non-elective courses
  const electiveCourses = Array.from(courseMap.values()).filter(c => c.is_elective);
  const nonElectiveCourses = Array.from(courseMap.values()).filter(c => !c.is_elective);

  // Generate dates (skip Sundays)
  const dates = generateExamDates(startDate, daysAvailable);

  // Track state
  const sectionExamDates = new Map(); // section -> Set of dates
  const dateExamCount = new Map();    // date -> count of exams
  const facultySlotAssignments = new Map(); // faculty -> Set of "date-slot"
  const roomDateSlotUsage = new Map(); // "room-date-slot" -> boolean

  const examSchedule = [];

  // Helper: Check if section can have exam on date
  const canScheduleSectionOnDate = (section, date) => {
    if (!sectionExamDates.has(section)) return true;
    return !sectionExamDates.get(section).has(date);
  };

  // Helper: Check if date has room for more exams
  const canScheduleOnDate = (date) => {
    const count = dateExamCount.get(date) || 0;
    return count < 4;
  };

  // Helper: Get available rooms for a date+slot
  const getAvailableRooms = (date, slot) => {
    const available = [];
    for (const room of examRooms) {
      const key = `${room.room_id}-${date}-${slot}`;
      if (!roomDateSlotUsage.has(key)) {
        available.push(room);
      }
    }
    return available;
  };

  // Helper: Allocate rooms for a section
  const allocateRooms = (sectionStrength, availableRooms, date, slot) => {
    const allocated = [];
    let remainingCapacity = 0;

    for (const room of availableRooms) {
      const halfCap = Math.floor(room.capacity / 2);
      allocated.push(room);
      remainingCapacity += halfCap;

      if (remainingCapacity >= sectionStrength) {
        break;
      }
    }

    if (remainingCapacity < sectionStrength) {
      return null; // Not enough capacity
    }

    // Mark rooms as used
    for (const room of allocated) {
      const key = `${room.room_id}-${date}-${slot}`;
      roomDateSlotUsage.set(key, true);
    }

    return allocated;
  };

  // Helper: Get invigilators for rooms
  const getInvigilators = (allocatedRooms, date, slot, facultyList) => {
    const invigilators = [];
    const usedFaculty = new Set();

    for (const room of allocatedRooms) {
      const needsTwo = room.capacity > 40;
      const count = needsTwo ? 2 : 1;

      for (let i = 0; i < count; i++) {
        // Find available faculty (round-robin, not used in this slot)
        let assigned = false;
        for (const faculty of facultyList) {
          const slotKey = `${date}-${slot}`;
          const facultyKey = `${faculty.faculty_id}-${slotKey}`;

          if (!usedFaculty.has(facultyKey) && !facultySlotAssignments.has(facultyKey)) {
            invigilators.push({
              faculty_id: faculty.faculty_id,
              name: faculty.name,
              room_id: room.room_id
            });
            usedFaculty.add(facultyKey);
            facultySlotAssignments.set(facultyKey, true);
            assigned = true;
            break;
          }
        }

        // Fallback: if no faculty available, assign "TBA"
        if (!assigned) {
          console.warn(`WARNING: No invigilator available for ${date} slot ${slot}, assigning "TBA"`);
          invigilators.push({
            faculty_id: 'TBA',
            name: 'TBA',
            room_id: room.room_id
          });
        }
      }
    }

    return invigilators;
  };

  // Load faculty list
  const facultyList = [];

  // Schedule elective courses first (they need same date+slot for all sections)
  for (const course of electiveCourses) {
    let scheduled = false;

    for (const date of dates) {
      if (scheduled) break;

      // Check if all sections can be scheduled on this date
      const allSectionsFree = course.sections.every(s =>
        canScheduleSectionOnDate(s.section, date)
      );

      if (!allSectionsFree) continue;
      if (!canScheduleOnDate(date)) continue;

      // Try each slot
      for (let slot = 1; slot <= slotsPerDay; slot++) {
        const availableRooms = getAvailableRooms(date, slot);

        // Allocate rooms for all sections
        const allAllocations = [];
        let canAllocate = true;
        const tempRoomUsage = new Set();

        for (const sec of course.sections) {
          // Simulate allocation
          let neededCapacity = sec.section_strength;
          let allocated = [];

          for (const room of availableRooms) {
            if (tempRoomUsage.has(room.room_id)) continue;

            const halfCap = Math.floor(room.capacity / 2);
            allocated.push(room);
            tempRoomUsage.add(room.room_id);
            neededCapacity -= halfCap;

            if (neededCapacity <= 0) break;
          }

          if (neededCapacity > 0) {
            canAllocate = false;
            break;
          }

          allAllocations.push({ section: sec.section, rooms: allocated });
        }

        if (!canAllocate) continue;

        // Commit allocations
        for (const alloc of allAllocations) {
          for (const room of alloc.rooms) {
            const key = `${room.room_id}-${date}-${slot}`;
            roomDateSlotUsage.set(key, true);
          }

          // Mark section as having exam on this date
          if (!sectionExamDates.has(alloc.section)) {
            sectionExamDates.set(alloc.section, new Set());
          }
          sectionExamDates.get(alloc.section).add(date);
        }

        // Get invigilators
        const allRooms = allAllocations.flatMap(a => a.rooms);
        const invigilators = getInvigilators(allRooms, date, slot, facultyList);

        // Add exam entry
        examSchedule.push({
          course_code: course.course_code,
          course_name: course.course_name,
          date,
          slot,
          slot_label: slot === 1 ? '9:00-12:00' : '2:00-5:00',
          sections: course.sections.map(s => s.section),
          rooms: allRooms.map(r => r.room_id),
          invigilators,
          is_elective: true
        });

        // Update date exam count
        dateExamCount.set(date, (dateExamCount.get(date) || 0) + 1);

        scheduled = true;
        break;
      }
    }

    if (!scheduled) {
      console.warn(`WARNING: Could not schedule exam for elective ${course.course_code}`);
    }
  }

  // Schedule non-elective courses
  for (const course of nonElectiveCourses) {
    for (const sec of course.sections) {
      let scheduled = false;

      for (const date of dates) {
        if (scheduled) break;
        if (!canScheduleSectionOnDate(sec.section, date)) continue;
        if (!canScheduleOnDate(date)) continue;

        for (let slot = 1; slot <= slotsPerDay; slot++) {
          const availableRooms = getAvailableRooms(date, slot);

          // Allocate rooms for this section
          const allocated = allocateRooms(sec.section_strength, availableRooms, date, slot);

          if (!allocated) continue;

          // Mark section as having exam on this date
          if (!sectionExamDates.has(sec.section)) {
            sectionExamDates.set(sec.section, new Set());
          }
          sectionExamDates.get(sec.section).add(date);

          // Get invigilators
          const invigilators = getInvigilators(allocated, date, slot, facultyList);

          // Add exam entry
          examSchedule.push({
            course_code: course.course_code,
            course_name: course.course_name,
            date,
            slot,
            slot_label: slot === 1 ? '9:00-12:00' : '2:00-5:00',
            sections: [sec.section],
            rooms: allocated.map(r => r.room_id),
            invigilators,
            is_elective: false
          });

          // Update date exam count
          dateExamCount.set(date, (dateExamCount.get(date) || 0) + 1);

          scheduled = true;
          break;
        }
      }

      if (!scheduled) {
        console.warn(`WARNING: Could not schedule exam for ${course.course_code} (${sec.section})`);
      }
    }
  }

  return examSchedule;
}

/**
 * Generate list of exam dates (skip Sundays)
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {number} daysAvailable - Number of days to consider
 * @returns {Array<string>} Array of date strings
 */
function generateExamDates(startDate, daysAvailable) {
  const dates = [];
  const start = new Date(startDate);

  for (let i = 0; i < daysAvailable; i++) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);

    // Skip Sundays (day 0)
    if (current.getDay() !== 0) {
      dates.push(current.toISOString().split('T')[0]);
    }
  }

  return dates;
}

module.exports = {
  generateExamSchedule,
  generateExamDates
};

// Test code
if (require.main === module) {
  console.log('=== Exam Scheduler Tests ===\n');

  const { loadRooms, loadFaculty, loadTimeSlots, loadAllCourses } = require('./dataLoader');

  (async () => {
    try {
      const rooms = await loadRooms();
      const faculty = await loadFaculty();
      const timeSlots = await loadTimeSlots();
      const courses = await loadAllCourses();

      console.log('Loaded data:');
      console.log(`  Rooms: ${rooms.length} (${rooms.filter(r => r.type !== 'lab').length} available for exams)`);
      console.log(`  Faculty: ${faculty.length}`);
      console.log(`  Courses: ${courses.length}`);

      const config = {
        startDate: '2025-11-01',
        daysAvailable: 14,
        slotsPerDay: 2
      };

      console.log('\nConfig:');
      console.log(`  Start: ${config.startDate}`);
      console.log(`  Days: ${config.daysAvailable}`);
      console.log(`  Slots/day: ${config.slotsPerDay}`);

      console.log('\nGenerating exam schedule...\n');
      const schedule = generateExamSchedule(courses, rooms, config);

      console.log('=== Exam Schedule ===\n');
      console.log(`Total exams scheduled: ${schedule.length}`);

      // Group by date
      const byDate = {};
      for (const exam of schedule) {
        if (!byDate[exam.date]) {
          byDate[exam.date] = [];
        }
        byDate[exam.date].push(exam);
      }

      for (const [date, exams] of Object.entries(byDate)) {
        console.log(`\n${date}:`);
        for (const exam of exams) {
          console.log(`  ${exam.course_code} (${exam.sections.join(', ')}) | ${exam.slot_label} | Rooms: ${exam.rooms.join(', ')}`);
        }
      }

      // Validation
      console.log('\n=== Validation ===');

      // Check: Max 1 exam per section per day
      const sectionDateMap = new Map();
      let sectionConflicts = 0;
      for (const exam of schedule) {
        for (const section of exam.sections) {
          const key = `${section}-${exam.date}`;
          if (sectionDateMap.has(key)) {
            sectionConflicts++;
            console.log(`  CONFLICT: ${section} has multiple exams on ${exam.date}`);
          }
          sectionDateMap.set(key, true);
        }
      }
      if (sectionConflicts === 0) {
        console.log('✓ No section has multiple exams on the same day');
      }

      // Check: Max 4 exams per day
      let overloadDays = 0;
      for (const [date, exams] of Object.entries(byDate)) {
        if (exams.length > 4) {
          overloadDays++;
          console.log(`  OVERLOAD: ${date} has ${exams.length} exams`);
        }
      }
      if (overloadDays === 0) {
        console.log('✓ No day has more than 4 exams');
      }

      // Check: Electives synced
      const electiveMap = new Map();
      for (const exam of schedule) {
        if (exam.is_elective) {
          const key = `${exam.course_code}-${exam.date}-${exam.slot}`;
          electiveMap.set(key, exam.sections);
        }
      }
      let syncIssues = 0;
      for (const [key, sections] of electiveMap) {
        const [courseCode] = key.split('-');
        const course = courses.find(c => c.course_code === courseCode && c.is_elective);
        if (course) {
          const allSections = courses
            .filter(c => c.course_code === courseCode)
            .map(c => c.section);
          const missing = allSections.filter(s => !sections.includes(s));
          if (missing.length > 0) {
            syncIssues++;
            console.log(`  SYNC ISSUE: ${courseCode} missing sections ${missing.join(', ')} on ${key}`);
          }
        }
      }
      if (syncIssues === 0) {
        console.log('✓ All elective sections are synced');
      }

      // Check: No Sunday exams
      let sundayExams = 0;
      for (const exam of schedule) {
        const date = new Date(exam.date);
        if (date.getDay() === 0) {
          sundayExams++;
          console.log(`  SUNDAY EXAM: ${exam.course_code} on ${exam.date}`);
        }
      }
      if (sundayExams === 0) {
        console.log('✓ No exams scheduled on Sundays');
      }

      console.log('\n=== All tests complete! ===');
    } catch (error) {
      console.error('Error:', error.message);
      console.error(error.stack);
    }
  })();
}
