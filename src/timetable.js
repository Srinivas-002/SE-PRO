/**
 * timetable.js - Main timetable generator orchestrator
 */

const SlotAllocator = require('./slotAllocator');
const RoomSelector = require('./roomSelector');
const { groupElectives, assignElectiveSlots } = require('./electiveSync');
const { detectHigherSem, groupByBasket, assignBasketSlots, getCoreCourses } = require('./basketScheduler');

/**
 * Generate session list from course L/T/P values
 * @param {Object} course - Course object with L, T, P values
 * @returns {Array} Array of session objects { type, duration, count }
 */
function generateSessionList(course) {
  const sessions = [];
  const L = course.L;
  const T = course.T;
  const P = course.P;

  // Lectures - dynamic duration based on L value
  if (L === 1) {
    sessions.push({ type: 'L', duration: 60, count: 1 });
  } else if (L === 2) {
    sessions.push({ type: 'L', duration: 60, count: 2 });
  } else if (L === 3) {
    sessions.push({ type: 'L', duration: 90, count: 2 });
  } else if (L === 4) {
    sessions.push({ type: 'L', duration: 90, count: 2 });
    sessions.push({ type: 'L', duration: 60, count: 1 });
  } else if (L >= 5) {
    sessions.push({ type: 'L', duration: 90, count: Math.ceil(L / 1.5) });
  }

  // Tutorials - always 1hr sessions, one per week per T value
  if (T > 0) {
    sessions.push({ type: 'T', duration: 60, count: T });
  }

  // Practicals - always 1.5hr contiguous block, P/2 sessions per week
  if (P > 0) {
    sessions.push({ type: 'P', duration: 90, count: P / 2 });
  }

  return sessions;
}

/**
 * Generate a complete timetable
 * @param {Array} courses - All courses from dataLoader
 * @param {Array} rooms - All rooms from dataLoader
 * @param {Object} timeSlots - { days, slots, breakSlots } from dataLoader
 * @returns {Array} Array of timetable entries
 */
function generateTimetable(courses, rooms, timeSlots) {
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

  const allEntries = [];
  const MAX_RETRY_ATTEMPTS = 300;

  // Group courses by section
  const coursesBySection = new Map();
  for (const course of courses) {
    if (!coursesBySection.has(course.section)) {
      coursesBySection.set(course.section, []);
    }
    coursesBySection.get(course.section).push(course);
  }

  // Process each section
  for (const [section, sectionCourses] of coursesBySection) {
    // Check if this is a higher semester section
    const isHigherSem = detectHigherSem(section, sectionCourses);

    if (isHigherSem) {
      // === HIGHER SEMESTER: Use basket-based scheduling ===

      // Separate core courses (basket=0) from elective baskets
      const coreCourses = getCoreCourses(sectionCourses);
      const electiveCourses = sectionCourses.filter(c => c.basket > 0);

      // Group elective courses by basket
      const basketMap = groupByBasket(electiveCourses);

      // Assign slots to all baskets (each basket gets one shared slot)
      const basketEntries = assignBasketSlots(basketMap, slotAllocator, roomSelector, {});
      allEntries.push(...basketEntries);

      // Schedule core courses normally
      for (const course of coreCourses) {
        const { course_code, course_title, faculty_ids, section: courseSection, L, T, P, students_enrolled, basket } = course;

        // Use first faculty ID or 'TBA'
        const actualFacultyId = (faculty_ids && faculty_ids.length > 0) ? faculty_ids[0] : 'TBA';
        if (!faculty_ids || faculty_ids.length === 0) {
          console.warn(`WARNING: Course ${course_code} has no faculty_id assigned, using "TBA"`);
        }

        // Generate session list from L/T/P values
        const sessions = generateSessionList(course);

        // Schedule each session type
        for (const session of sessions) {
          const { type, duration, count } = session;
          let scheduledCount = 0;
          let attempts = 0;

          while (scheduledCount < count && attempts < MAX_RETRY_ATTEMPTS) {
            attempts++;

            if (type === 'P') {
              const found = slotAllocator.findFreeSlot(actualFacultyId, courseSection, null, 90);
              if (!found) {
                console.warn(`WARNING: Could not find slot for ${course_code} ${type} session ${scheduledCount + 1} (attempt ${attempts})`);
                continue; // Try next slot, don't break
              }

              const room = roomSelector.findRoom('P', students_enrolled || 60, course_title, found.day, found.slot, course_code);
              if (!room) {
                console.warn(`WARNING: No room for ${course_code} ${type} session ${scheduledCount + 1} (attempt ${attempts})`);
                // Don't break - release this attempt and try next available slot
                continue;
              }

              slotAllocator.bookSlot(actualFacultyId, courseSection, room.room_id, found.day, found.slot);
              roomSelector.bookRoom(room.room_id, found.day, found.slot);

              const slotLabel = timeSlots.slots.find(s => s.id === found.slot)?.label || '';
              allEntries.push({
                course_code,
                course_name: course_title,
                faculty_id: actualFacultyId,
                section: courseSection,
                day: found.day,
                slot_id: found.slot,
                slot_label: slotLabel,
                room_id: room.room_id,
                room_name: room.name,
                room_capacity: room.capacity,
                type: 'P',
                room_requirements: course.room_requirements || [],
                duration: 90
              });
              scheduledCount++;
            } else {
              const found = slotAllocator.findFreeSlot(actualFacultyId, courseSection, null, duration);
              if (!found) {
                console.warn(`WARNING: Could not find slot for ${course_code} ${type} session ${scheduledCount + 1} (attempt ${attempts})`);
                continue; // Try next slot, don't break
              }

              const room = roomSelector.findRoom(type, students_enrolled || 60, course_title, found.day, found.slot, course_code);
              if (!room) {
                console.warn(`WARNING: No room for ${course_code} ${type} session ${scheduledCount + 1} (attempt ${attempts})`);
                continue; // Try next slot, don't break
              }

              slotAllocator.bookSlot(actualFacultyId, courseSection, room.room_id, found.day, found.slot);
              roomSelector.bookRoom(room.room_id, found.day, found.slot);

              const slotLabel = timeSlots.slots.find(s => s.id === found.slot)?.label || '';
              allEntries.push({
                course_code,
                course_name: course_title,
                faculty_id: actualFacultyId,
                section: courseSection,
                day: found.day,
                slot_id: found.slot,
                slot_label: slotLabel,
                room_id: room.room_id,
                room_name: room.name,
                room_capacity: room.capacity,
                type,
                room_requirements: course.room_requirements || [],
                duration
              });
              scheduledCount++;
            }
          }

          // Log if not all sessions were scheduled
          if (scheduledCount < count) {
            console.error(`ERROR: Only ${scheduledCount}/${count} ${type} sessions scheduled for ${course_code} (${course_title}) - gave up after ${attempts} attempts`);
          }
        }
      }

      // === REGULAR SEMESTER: Use existing logic ===

      const sectionEntries = [];

      for (const course of sectionCourses) {
        const { course_code, course_title, faculty_id, section: courseSection, L, T, P, students_enrolled, is_elective } = course;

        const actualFacultyId = faculty_id || 'TBA';
        if (!faculty_id) {
          console.warn(`WARNING: Course ${course_code} has no faculty_id assigned, using "TBA"`);
        }

        const sessions = generateSessionList(course);

        for (const session of sessions) {
          const { type, duration, count } = session;
          let scheduledCount = 0;
          let attempts = 0;

          while (scheduledCount < count && attempts < MAX_RETRY_ATTEMPTS) {
            attempts++;

            if (type === 'P') {
              const found = slotAllocator.findFreeSlot(actualFacultyId, courseSection, null, 90);
              if (!found) {
                console.warn(`WARNING: Could not find slot for ${course_code} ${type} session ${scheduledCount + 1} (attempt ${attempts})`);
                continue;
              }

              const room = roomSelector.findRoom('P', students_enrolled || 60, course_title, found.day, found.slot, course_code);
              if (!room) {
                console.warn(`WARNING: No room for ${course_code} ${type} session ${scheduledCount + 1} (attempt ${attempts})`);
                continue;
              }

              slotAllocator.bookSlot(actualFacultyId, courseSection, room.room_id, found.day, found.slot);
              roomSelector.bookRoom(room.room_id, found.day, found.slot);

              const slotLabel = timeSlots.slots.find(s => s.id === found.slot)?.label || '';
              sectionEntries.push({
                course_code,
                course_name: course_title,
                faculty_id: actualFacultyId,
                section: courseSection,
                day: found.day,
                slot_id: found.slot,
                slot_label: slotLabel,
                room_id: room.room_id,
                room_name: room.name,
                room_capacity: room.capacity,
                type: 'P',
                room_requirements: course.room_requirements || [],
                duration: 90
              });
              scheduledCount++;
            } else {
              const found = slotAllocator.findFreeSlot(actualFacultyId, courseSection, null, duration);
              if (!found) {
                console.warn(`WARNING: Could not find slot for ${course_code} ${type} session ${scheduledCount + 1} (attempt ${attempts})`);
                continue;
              }

              const room = roomSelector.findRoom(type, students_enrolled || 60, course_title, found.day, found.slot, course_code);
              if (!room) {
                console.warn(`WARNING: No room for ${course_code} ${type} session ${scheduledCount + 1} (attempt ${attempts})`);
                continue;
              }

              slotAllocator.bookSlot(actualFacultyId, courseSection, room.room_id, found.day, found.slot);
              roomSelector.bookRoom(room.room_id, found.day, found.slot);

              const slotLabel = timeSlots.slots.find(s => s.id === found.slot)?.label || '';
              sectionEntries.push({
                course_code,
                course_name: course_title,
                faculty_id: actualFacultyId,
                section: courseSection,
                day: found.day,
                slot_id: found.slot,
                slot_label: slotLabel,
                room_id: room.room_id,
                room_name: room.name,
                room_capacity: room.capacity,
                type,
                room_requirements: course.room_requirements || [],
                duration
              });
              scheduledCount++;
            }
          }

          // Log if not all sessions were scheduled
          if (scheduledCount < count) {
            console.error(`ERROR: Only ${scheduledCount}/${count} ${type} sessions scheduled for ${course_code} (${course_title}) - gave up after ${attempts} attempts`);
          }
        }
      }

      allEntries.push(...sectionEntries);
    }
  }

  return allEntries;
}

module.exports = {
  generateTimetable,
  generateSessionList
};

// Test code - runs only when executed directly
if (require.main === module) {
  console.log('=== Timetable Generator Tests ===\n');

  const { loadRooms, loadFaculty, loadTimeSlots, loadAllCourses } = require('./dataLoader');

  // Test generateSessionList
  console.log('Test: generateSessionList function');
  const testCases = [
    { course: { L: 1, T: 0, P: 0 }, expected: [{ type: 'L', duration: 60, count: 1 }] },
    { course: { L: 2, T: 1, P: 0 }, expected: [{ type: 'L', duration: 60, count: 2 }, { type: 'T', duration: 60, count: 1 }] },
    { course: { L: 3, T: 0, P: 0 }, expected: [{ type: 'L', duration: 90, count: 2 }] },
    { course: { L: 4, T: 0, P: 2 }, expected: [{ type: 'L', duration: 90, count: 2 }, { type: 'L', duration: 60, count: 1 }, { type: 'P', duration: 90, count: 1 }] },
    { course: { L: 5, T: 1, P: 4 }, expected: [{ type: 'L', duration: 90, count: 4 }, { type: 'T', duration: 60, count: 1 }, { type: 'P', duration: 90, count: 2 }] }
  ];

  for (const tc of testCases) {
    const result = generateSessionList(tc.course);
    const match = JSON.stringify(result) === JSON.stringify(tc.expected);
    console.log(`  L=${tc.course.L}, T=${tc.course.T}, P=${tc.course.P}: ${match ? 'PASS' : 'FAIL'}`);
    if (!match) {
      console.log(`    Expected: ${JSON.stringify(tc.expected)}`);
      console.log(`    Got: ${JSON.stringify(result)}`);
    }
  }

  // Load real data
  (async () => {
    try {
      const rooms = await loadRooms();
      const faculty = await loadFaculty();
      const timeSlots = await loadTimeSlots();
      const courses = await loadAllCourses();

      console.log('\nLoaded data:');
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
          console.log(`  ${e.section} | ${e.type} | ${e.day} | ${e.slot_label} | ${e.room_name}${e.duration ? ` (${e.duration}min)` : ''}`);
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
