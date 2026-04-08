/**
 * timetable.js - Main timetable generator orchestrator
 */

const SlotAllocator = require('./slotAllocator');
const RoomSelector = require('./roomSelector');
const { groupElectives, assignElectiveSlots } = require('./electiveSync');

/**
 * Generate a complete timetable
 * @param {Array} courses - All courses from dataLoader
 * @param {Array} rooms - All rooms from dataLoader
 * @param {Object} timeSlots - { days, slots, breakSlots } from dataLoader
 * @returns {Array} Array of timetable entries
 */
function generateTimetable(courses, rooms, timeSlots) {
  // Step 1: Separate elective and non-elective courses
  const electiveCourses = courses.filter(c => c.is_elective);
  const nonElectiveCourses = courses.filter(c => !c.is_elective);

  // Step 2: Group electives and assign slots
  const electiveGroups = groupElectives(electiveCourses);

  // Create SINGLE global slotAllocator and roomSelector shared across ALL sections
  // This ensures faculty conflicts and room conflicts are checked ACROSS all sections
  const slotAllocator = new SlotAllocator(timeSlots);
  const roomSelector = new RoomSelector(rooms);

  // Initialize room bookings in slotAllocator
  rooms.forEach(r => {
    if (!slotAllocator.roomBookings.has(r.room_id)) {
      slotAllocator.roomBookings.set(r.room_id, new Set());
    }
  });

  // Assign elective slots (pre-assigns and books them)
  const electiveEntries = assignElectiveSlots(electiveGroups, slotAllocator, roomSelector, timeSlots);

  // Step 3: Group non-elective courses by section
  const coursesBySection = new Map();
  for (const course of nonElectiveCourses) {
    if (!coursesBySection.has(course.section)) {
      coursesBySection.set(course.section, []);
    }
    coursesBySection.get(course.section).push(course);
  }

  // Step 4: Process each section independently through the shared SlotAllocator
  const allNonElectiveEntries = [];
  const MAX_RETRY_ATTEMPTS = 300;

  for (const [section, sectionCourses] of coursesBySection) {
    const sectionEntries = [];

    for (const course of sectionCourses) {
      const { course_code, name, faculty_id, section: courseSection, L, T, P, section_strength, is_elective } = course;

      // Validate faculty exists (warn if unknown)
      const actualFacultyId = faculty_id || 'TBA';
      if (!faculty_id) {
        console.warn(`WARNING: Course ${course_code} has no faculty_id assigned, using "TBA"`);
      }

      // Schedule L lectures (1 hour each) with retry cap
      let lAttempts = 0;
      for (let i = 0; i < L && lAttempts < MAX_RETRY_ATTEMPTS; i++) {
        lAttempts++;
        // Uses shared slotAllocator - checks faculty conflicts ACROSS all sections
        const found = slotAllocator.findFreeSlot(actualFacultyId, courseSection);
        if (!found) {
          console.warn(`WARNING: Could not find slot for ${course_code} L session ${i + 1}`);
          continue;
        }

        const room = roomSelector.findRoomByStrength('L', section_strength, found.day, found.slot, course.room_requirements || [], course_code);
        if (!room) {
          console.warn(`WARNING: No room for ${course_code} L session ${i + 1}`);
          continue;
        }

        // Books to shared slotAllocator and roomSelector - prevents cross-section conflicts
        slotAllocator.bookSlot(actualFacultyId, courseSection, room.room_id, found.day, found.slot);
        roomSelector.bookRoom(room.room_id, found.day, found.slot);

        sectionEntries.push({
          course_code,
          course_name: name,
          faculty_id: actualFacultyId,
          section: courseSection,
          day: found.day,
          slot_id: found.slot,
          slot_label: timeSlots.slots.find(s => s.id === found.slot)?.label || '',
          room_id: room.room_id,
          room_name: room.name,
          room_capacity: room.capacity,
          type: 'L',
          room_requirements: course.room_requirements || []
        });
      }

      // Schedule T tutorials (1 hour each) with retry cap
      let tAttempts = 0;
      for (let i = 0; i < T && tAttempts < MAX_RETRY_ATTEMPTS; i++) {
        tAttempts++;
        const found = slotAllocator.findFreeSlot(actualFacultyId, courseSection);
        if (!found) {
          console.warn(`WARNING: Could not find slot for ${course_code} T session ${i + 1}`);
          continue;
        }

        const room = roomSelector.findRoomByStrength('T', section_strength, found.day, found.slot, course.room_requirements || [], course_code);
        if (!room) {
          console.warn(`WARNING: No room for ${course_code} T session ${i + 1}`);
          continue;
        }

        slotAllocator.bookSlot(actualFacultyId, courseSection, room.room_id, found.day, found.slot);
        roomSelector.bookRoom(room.room_id, found.day, found.slot);

        sectionEntries.push({
          course_code,
          course_name: name,
          faculty_id: actualFacultyId,
          section: courseSection,
          day: found.day,
          slot_id: found.slot,
          slot_label: timeSlots.slots.find(s => s.id === found.slot)?.label || '',
          room_id: room.room_id,
          room_name: room.name,
          room_capacity: room.capacity,
          type: 'T',
          room_requirements: course.room_requirements || []
        });
      }

      // Schedule P practicals (2-hour contiguous blocks) with retry cap
      let pAttempts = 0;
      for (let i = 0; i < P && pAttempts < MAX_RETRY_ATTEMPTS; i++) {
        pAttempts++;
        const contiguous = slotAllocator.findContiguousSlots(actualFacultyId, courseSection, '_LAB', 2);
        if (!contiguous) {
          console.warn(`WARNING: Could not find contiguous slots for ${course_code} P session ${i + 1}`);
          continue;
        }

        const firstSlot = contiguous[0];
        // For practical sessions, always pass room requirements
        let room = roomSelector.findRoom('P', section_strength, firstSlot.day, firstSlot.slot, course.room_requirements || [], course_code);

        if (!room) {
          console.warn(`WARNING: No lab room for ${course_code} P session ${i + 1}, using classroom`);
          room = roomSelector.findRoom('L', section_strength, firstSlot.day, firstSlot.slot, course.room_requirements || [], course_code);
          if (!room) {
            console.warn(`WARNING: No room available for ${course_code} P session ${i + 1}`);
            continue;
          }
        }

        for (const cs of contiguous) {
          slotAllocator.bookSlot(actualFacultyId, courseSection, room.room_id, cs.day, cs.slot);
          roomSelector.bookRoom(room.room_id, cs.day, cs.slot);
        }

        const slotLabels = contiguous.map(cs =>
          timeSlots.slots.find(s => s.id === cs.slot)?.label || ''
        ).join(' - ');

        sectionEntries.push({
          course_code,
          course_name: name,
          faculty_id: actualFacultyId,
          section: courseSection,
          day: firstSlot.day,
          slot_id: contiguous.map(c => c.slot),
          slot_label: slotLabels,
          room_id: room.room_id,
          room_name: room.name,
          room_capacity: room.capacity,
          type: 'P',
          room_requirements: course.room_requirements || []
        });
      }
    }

    allNonElectiveEntries.push(...sectionEntries);
  }

  // Step 5: Merge elective and non-elective entries
  const allEntries = [...electiveEntries, ...allNonElectiveEntries];

  return allEntries;
}

module.exports = {
  generateTimetable
};

// Test code - runs only when executed directly
if (require.main === module) {
  console.log('=== Timetable Generator Tests ===\n');

  const { loadRooms, loadFaculty, loadTimeSlots, loadAllCourses } = require('./dataLoader');

  // Load real data
  (async () => {
    try {
      const rooms = await loadRooms();
      const faculty = await loadFaculty();
      const timeSlots = await loadTimeSlots();
      const courses = await loadAllCourses();

      console.log('Loaded data:');
      console.log(`  Rooms: ${rooms.length}`);
      console.log(`  Faculty: ${faculty.length}`);
      console.log(`  Time slots: ${timeSlots.slots.length} regular + ${timeSlots.breakSlots.length} break`);
      console.log(`  Courses: ${courses.length}`);
      console.log(`  Electives: ${courses.filter(c => c.is_elective).length}`);
      console.log(`  Non-electives: ${courses.filter(c => !c.is_elective).length}`);

      console.log('\nGenerating timetable...\n');
      const timetable = generateTimetable(courses, rooms, timeSlots);

      console.log('=== Generated Timetable ===\n');
      console.log(`Total entries: ${timetable.length}`);

      // Group by course for display
      const byCourse = {};
      for (const entry of timetable) {
        if (!byCourse[entry.course_code]) {
          byCourse[entry.course_code] = [];
        }
        byCourse[entry.course_code].push(entry);
      }

      for (const [code, entries] of Object.entries(byCourse)) {
        console.log(`\n${code}:`);
        for (const e of entries) {
          console.log(`  ${e.section} | ${e.type} | ${e.day} | ${e.slot_label} | ${e.room_name}`);
        }
      }

      // Validation checks
      console.log('\n=== Validation ===');

      // Helper to get slots as array
      const getSlots = (entry) => Array.isArray(entry.slot_id) ? entry.slot_id : [entry.slot_id];

      // Helper to check if two entries have overlapping slots
      const slotsOverlap = (e1, e2) => {
        const slots1 = getSlots(e1);
        const slots2 = getSlots(e2);
        return slots1.some(s1 => slots2.includes(s1));
      };

      // Check for conflicts (same faculty, same slot)
      const facultyConflicts = [];
      const checked = new Set();
      for (const e1 of timetable) {
        for (const e2 of timetable) {
          if (e1 === e2) continue;
          const key = [e1.course_code, e1.section, e2.course_code, e2.section].sort().join('|');
          if (checked.has(key)) continue;
          checked.add(key);

          // Same course code = elective sync (expected), different course = real conflict
          if (e1.faculty_id === e2.faculty_id && e1.day === e2.day && slotsOverlap(e1, e2) && e1.course_code !== e2.course_code) {
            facultyConflicts.push(`${e1.course_code}(${e1.section}) and ${e2.course_code}(${e2.section}) share faculty ${e1.faculty_id} at ${e1.day} slot ${e1.slot_id}`);
          }
        }
      }

      if (facultyConflicts.length > 0) {
        console.log('FACULTY CONFLICTS FOUND:');
        facultyConflicts.forEach(c => console.log(`  - ${c}`));
      } else {
        console.log('✓ No faculty conflicts');
      }

      // Check for room conflicts
      const roomConflicts = [];
      const roomChecked = new Set();
      for (const e1 of timetable) {
        for (const e2 of timetable) {
          if (e1 === e2) continue;
          const key = [e1.room_id, e1.day, e1.slot_id, e2.room_id, e2.day, e2.slot_id].toString();
          if (roomChecked.has(key)) continue;
          roomChecked.add(key);

          if (e1.room_id === e2.room_id && e1.day === e2.day && slotsOverlap(e1, e2)) {
            roomConflicts.push(`${e1.course_code} and ${e2.course_code} both in ${e1.room_name} at ${e1.day} slot ${e1.slot_id}`);
          }
        }
      }

      if (roomConflicts.length > 0) {
        console.log('ROOM CONFLICTS FOUND:');
        roomConflicts.forEach(c => console.log(`  - ${c}`));
      } else {
        console.log('✓ No room conflicts');
      }

      // Check section conflicts (same section, same slot)
      const sectionConflicts = [];
      const sectionChecked = new Set();
      for (const e1 of timetable) {
        for (const e2 of timetable) {
          if (e1 === e2 || e1.section !== e2.section) continue;
          const key = [e1.course_code, e2.course_code, e1.day, e1.slot_id].toString();
          if (sectionChecked.has(key)) continue;
          sectionChecked.add(key);

          if (e1.day === e2.day && slotsOverlap(e1, e2)) {
            sectionConflicts.push(`${e1.course_code} and ${e2.course_code} both in ${e1.section} at ${e1.day} slot ${e1.slot_id}`);
          }
        }
      }

      if (sectionConflicts.length > 0) {
        console.log('SECTION CONFLICTS FOUND:');
        sectionConflicts.forEach(c => console.log(`  - ${c}`));
      } else {
        console.log('✓ No section conflicts');
      }

      // Check electives are synced
      console.log('\n=== Elective Sync Check ===');
      const electiveEntries = timetable.filter(e => ['CS104'].includes(e.course_code));
      const cs104Slots = {};
      for (const e of electiveEntries) {
        if (!cs104Slots[e.course_code]) {
          cs104Slots[e.course_code] = new Set();
        }
        const slotKey = `${e.day}-${Array.isArray(e.slot_id) ? e.slot_id.join(',') : e.slot_id}`;
        cs104Slots[e.course_code].add(slotKey);
      }

      for (const [code, slots] of Object.entries(cs104Slots)) {
        console.log(`${code}: ${slots.size} unique slot(s) - ${Array.from(slots).join(', ')}`);
        if (slots.size === 1) {
          console.log(`  ✓ All sections of ${code} are synced`);
        } else {
          console.log(`  ✗ WARNING: ${code} sections are NOT synced!`);
        }
      }

      console.log('\n=== Timetable generation complete! ===');
    } catch (error) {
      console.error('Error:', error.message);
      console.error(error.stack);
    }
  })();
}
