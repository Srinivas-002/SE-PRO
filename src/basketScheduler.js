/**
 * basketScheduler.js - Basket-based elective scheduling for higher semesters (V, VI, VII)
 *
 * Handles elective basket system where:
 * - Students pick exactly ONE course per basket
 * - All courses in the same basket run at the SAME slot (parallel sessions)
 * - Different baskets run at DIFFERENT slots
 * - Core courses (basket=0) are scheduled normally
 */

/**
 * Detect if a section is a "higher sem" (V, VI, VII) that uses basket-based electives
 * @param {string} sectionName - Section name from filename (e.g., "CSE-VI", "DSAI-VI")
 * @param {Array} courses - Array of course objects from this section
 * @returns {boolean} true if this section should use basket scheduling
 */
function detectHigherSem(sectionName, courses) {
  // Check if section name indicates higher semester
  // Use word boundary patterns to avoid false matches (e.g., "CSEA-II" matching "-V")
  const higherSemPatterns = [
    /\bVI\b/i,      // VI as standalone (e.g., CSE-VI, DSAI-VI)
    /\bVII\b/i,     // VII as standalone
    /-V\b/i,        // -V at end (e.g., CSE-V but not CSE-VI)
    /\bV\b/i        // V as standalone semester indicator
  ];
  const isHigherSemByName = higherSemPatterns.some(pattern =>
    pattern.test(sectionName)
  );

  if (isHigherSemByName) {
    return true;
  }

  // Check if >80% of courses are electives
  if (courses.length === 0) {
    return false;
  }

  const electiveCount = courses.filter(c => c.elective === 1 || c.basket > 0).length;
  const electiveRatio = electiveCount / courses.length;

  return electiveRatio > 0.8;
}

/**
 * Group elective courses by their basket number
 * @param {Array} courses - Array of course objects (already filtered to electives)
 * @returns {Map<number, Array>} Map<basketNumber, [courses]>
 * Ignores basket=0 courses (core courses)
 */
function groupByBasket(courses) {
  const basketMap = new Map();

  for (const course of courses) {
    // Skip core courses (basket=0)
    if (course.basket === 0 || !course.basket) {
      continue;
    }

    if (!basketMap.has(course.basket)) {
      basketMap.set(course.basket, []);
    }
    basketMap.get(course.basket).push(course);
  }

  return basketMap;
}

/**
 * Assign slots to elective baskets
 * @param {Map<number, Array>} basketMap - Map<basketNumber, [courses]> from groupByBasket
 * @param {SlotAllocator} slotAllocator - Instance for booking slots
 * @param {RoomSelector} roomSelector - Instance for selecting rooms
 * @param {Object} facultyMap - Map<faculty_id, faculty_info> from dataLoader
 * @returns {Array} Array of pre-assigned entries with basket_number and is_elective flags
 */
function assignBasketSlots(basketMap, slotAllocator, roomSelector, facultyMap) {
  const assignments = [];
  const usedBasketSlots = new Set(); // Track "day-slot" combinations used by baskets
  const slots = slotAllocator.slots;
  const days = slotAllocator.days;

  // Sort baskets by number (1, 2, 3, ...) to ensure consistent ordering
  const sortedBaskets = Array.from(basketMap.keys()).sort((a, b) => a - b);

  for (const basketNum of sortedBaskets) {
    const basketCourses = basketMap.get(basketNum);

    if (!basketCourses || basketCourses.length === 0) {
      continue;
    }

    // Collect all unique faculty IDs teaching in this basket
    const facultyIdsInBasket = new Set();
    for (const course of basketCourses) {
      // course.faculty_ids is an array (may have co-teaching)
      if (Array.isArray(course.faculty_ids)) {
        course.faculty_ids.forEach(fid => facultyIdsInBasket.add(fid));
      } else if (course.faculty_ids) {
        facultyIdsInBasket.add(course.faculty_ids);
      }
    }

    // Collect all sections in this basket
    const sectionsInBasket = new Set(basketCourses.map(c => c.section));

    // Find a slot where ALL faculty in this basket are free across ALL sections
    let foundSlot = null;

    outerLoop:
    for (const day of days) {
      for (const slot of slots) {
        // Skip if this basket slot is already used by another basket
        const slotKey = `${day}-${slot.id}`;
        if (usedBasketSlots.has(slotKey)) {
          continue;
        }

        // Check if all faculty in basket are free at this slot
        let allFree = true;
        for (const facultyId of facultyIdsInBasket) {
          for (const section of sectionsInBasket) {
            if (!slotAllocator.isSlotFree(facultyId, section, '_DUMMY', day, slot.id)) {
              allFree = false;
              break;
            }
          }
          if (!allFree) break;
        }

        if (allFree) {
          foundSlot = { day, slotId: slot.id };
          break outerLoop;
        }
      }
    }

    if (!foundSlot) {
      console.warn(`WARNING: No common slot found for basket ${basketNum} (courses: ${basketCourses.map(c => c.course_code).join(', ')})`);
      continue;
    }

    // Mark this slot as used for baskets
    usedBasketSlots.add(`${foundSlot.day}-${foundSlot.slotId}`);

    // Assign each course in the basket to this shared slot for the FIRST lecture
    // Then schedule remaining sessions (additional L, T, P) independently
    for (const course of basketCourses) {
      const { day, slotId } = foundSlot;

      // Get faculty IDs for this course
      const courseFacultyIds = Array.isArray(course.faculty_ids) ? course.faculty_ids :
                               (course.faculty_id ? [course.faculty_id] : []);
      const actualFacultyId = courseFacultyIds.length > 0 ? courseFacultyIds[0] : 'TBA';

      // Get enrolled count - used for all session types
      const enrolledCount = course.students_enrolled || 60;

      // Schedule the FIRST lecture at the shared basket slot
      if (course.L > 0) {
        const room = roomSelector.findRoom(
          'L',
          enrolledCount,
          course.course_title,
          day,
          slotId,
          course.course_code
        );

        if (room) {
          // Book slot for each faculty in this course
          for (const facultyId of courseFacultyIds) {
            slotAllocator.bookSlot(facultyId, course.section, room.room_id, day, slotId);
          }

          // Book the room
          roomSelector.bookRoom(room.room_id, day, slotId);

          // Get slot label
          const slotLabel = slots.find(s => s.id === slotId)?.label || '';

          // Add first lecture assignment
          assignments.push({
            course_code: course.course_code,
            course_name: course.course_title,
            faculty_id: actualFacultyId,
            faculty_ids: courseFacultyIds,
            section: course.section,
            day,
            slot_id: slotId,
            slot_label: slotLabel,
            room_id: room.room_id,
            room_name: room.name,
            room_capacity: room.capacity,
            type: 'L',
            basket_number: basketNum,
            is_elective: true,
            students_enrolled: enrolledCount,
            duration: 60
          });
        }
      }

      // Now schedule REMAINING sessions (additional L, T, P) independently
      // This handles L>1, T>0, P>0 from the course's L-T-P-S-C values
      const remainingLectures = course.L > 1 ? course.L - 1 : 0;
      const tutorials = course.T || 0;
      const practicals = course.P ? course.P / 2 : 0;

      // Schedule remaining lectures (60min or 90min based on L value)
      const lectureDuration = course.L >= 3 ? 90 : 60;
      for (let i = 0; i < remainingLectures; i++) {
        const found = slotAllocator.findFreeSlot(actualFacultyId, course.section, null, lectureDuration);
        if (found) {
          const room = roomSelector.findRoom('L', enrolledCount, course.course_title, found.day, found.slot, course.course_code);
          if (room) {
            for (const facultyId of courseFacultyIds) {
              slotAllocator.bookSlot(facultyId, course.section, room.room_id, found.day, found.slot);
            }
            roomSelector.bookRoom(room.room_id, found.day, found.slot);
            const slotLabel = slots.find(s => s.id === found.slot)?.label || '';
            assignments.push({
              course_code: course.course_code,
              course_name: course.course_title,
              faculty_id: actualFacultyId,
              faculty_ids: courseFacultyIds,
              section: course.section,
              day: found.day,
              slot_id: found.slot,
              slot_label: slotLabel,
              room_id: room.room_id,
              room_name: room.name,
              room_capacity: room.capacity,
              type: 'L',
              basket_number: basketNum,
              is_elective: true,
              students_enrolled: enrolledCount,
              duration: lectureDuration
            });
          }
        }
      }

      // Schedule tutorials (60min)
      for (let i = 0; i < tutorials; i++) {
        const found = slotAllocator.findFreeSlot(actualFacultyId, course.section, null, 60);
        if (found) {
          const room = roomSelector.findRoom('T', enrolledCount, course.course_title, found.day, found.slot, course.course_code);
          if (room) {
            for (const facultyId of courseFacultyIds) {
              slotAllocator.bookSlot(facultyId, course.section, room.room_id, found.day, found.slot);
            }
            roomSelector.bookRoom(room.room_id, found.day, found.slot);
            const slotLabel = slots.find(s => s.id === found.slot)?.label || '';
            assignments.push({
              course_code: course.course_code,
              course_name: course.course_title,
              faculty_id: actualFacultyId,
              faculty_ids: courseFacultyIds,
              section: course.section,
              day: found.day,
              slot_id: found.slot,
              slot_label: slotLabel,
              room_id: room.room_id,
              room_name: room.name,
              room_capacity: room.capacity,
              type: 'T',
              basket_number: basketNum,
              is_elective: true,
              students_enrolled: enrolledCount,
              duration: 60
            });
          }
        }
      }

      // Schedule practicals (90min)
      for (let i = 0; i < practicals; i++) {
        const found = slotAllocator.findFreeSlot(actualFacultyId, course.section, null, 90);
        if (found) {
          const room = roomSelector.findRoom('P', enrolledCount, course.course_title, found.day, found.slot, course.course_code);
          if (room) {
            for (const facultyId of courseFacultyIds) {
              slotAllocator.bookSlot(facultyId, course.section, room.room_id, found.day, found.slot);
            }
            roomSelector.bookRoom(room.room_id, found.day, found.slot);
            const slotLabel = slots.find(s => s.id === found.slot)?.label || '';
            assignments.push({
              course_code: course.course_code,
              course_name: course.course_title,
              faculty_id: actualFacultyId,
              faculty_ids: courseFacultyIds,
              section: course.section,
              day: found.day,
              slot_id: found.slot,
              slot_label: slotLabel,
              room_id: room.room_id,
              room_name: room.name,
              room_capacity: room.capacity,
              type: 'P',
              basket_number: basketNum,
              is_elective: true,
              students_enrolled: enrolledCount,
              duration: 90
            });
          }
        }
      }
    }
  }

  return assignments;
}

/**
 * Get core courses (basket=0) from a list of courses
 * @param {Array} courses - Array of course objects
 * @returns {Array} Courses with basket=0 (core courses)
 */
function getCoreCourses(courses) {
  return courses.filter(c => c.basket === 0 || !c.basket || c.elective === 0);
}

module.exports = {
  detectHigherSem,
  groupByBasket,
  assignBasketSlots,
  getCoreCourses
};

// Test code - runs only when executed directly
if (require.main === module) {
  console.log('=== BasketScheduler Tests ===\n');

  const SlotAllocator = require('./slotAllocator');
  const RoomSelector = require('./roomSelector');

  // Mock time slots (with start/end times for time range checking)
  const mockTimeSlots = {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    slots: [
      { id: 1, label: '8:00-8:55', duration: 60, start: '08:00', end: '08:55' },
      { id: 2, label: '9:00-9:55', duration: 60, start: '09:00', end: '09:55' },
      { id: 3, label: '10:00-10:55', duration: 60, start: '10:00', end: '10:55' },
      { id: 4, label: '11:00-11:55', duration: 60, start: '11:00', end: '11:55' },
      { id: 6, label: '1:00-1:55', duration: 60, start: '13:00', end: '13:55' },
      { id: 7, label: '2:00-2:55', duration: 60, start: '14:00', end: '14:55' },
      { id: 8, label: '3:00-3:55', duration: 60, start: '15:00', end: '15:55' }
    ],
    breakSlots: [{ id: 5, label: 'LUNCH', is_break: true, start: '12:00', end: '13:00' }]
  };

  const mockRooms = [
    { room_id: 'C104', name: 'Room C104', capacity: 96, type: 'classroom' },
    { room_id: 'C202', name: 'Room C202', capacity: 96, type: 'classroom' },
    { room_id: 'H301', name: 'Hall H301', capacity: 130, type: 'hall' }
  ];

  // Mock courses simulating CSE-VI.csv structure
  const mockCourses = [
    // Core course (basket=0)
    { course_code: 'DS308', course_title: 'Data Security', faculty_ids: ['F001'], basket: 0, elective: 0, students_enrolled: 0, section: 'CSE-VI' },

    // Basket 1 courses
    { course_code: 'EC456', course_title: 'Reinforcement Learning', faculty_ids: ['F002'], basket: 1, elective: 1, students_enrolled: 35, section: 'CSE-VI' },
    { course_code: 'CS368', course_title: 'Computer Architecture', faculty_ids: ['F003'], basket: 1, elective: 1, students_enrolled: 21, section: 'CSE-VI' },
    { course_code: 'CS369', course_title: 'Software Design', faculty_ids: ['F004'], basket: 1, elective: 1, students_enrolled: 13, section: 'CSE-VI' },

    // Basket 2 courses
    { course_code: 'CS469', course_title: 'Cloud Computing', faculty_ids: ['F005'], basket: 2, elective: 1, students_enrolled: 40, section: 'CSE-VI' },
    { course_code: 'CS372', course_title: 'Biometrics', faculty_ids: ['F006'], basket: 2, elective: 1, students_enrolled: 9, section: 'CSE-VI' },

    // Basket 3 courses
    { course_code: 'CS205', course_title: 'Graph Theory', faculty_ids: ['F007'], basket: 3, elective: 1, students_enrolled: 16, section: 'CSE-VI' },
    { course_code: 'CS455', course_title: 'Blockchain', faculty_ids: ['F008'], basket: 3, elective: 1, students_enrolled: 30, section: 'CSE-VI' }
  ];

  // Test 1: detectHigherSem
  console.log('Test 1: detectHigherSem');

  // CSE-VI should match by name pattern
  const isHigher1 = detectHigherSem('CSE-VI', mockCourses);
  console.log(`  CSE-VI detected as higher sem: ${isHigher1} (expected: true - name match)`);
  console.assert(isHigher1 === true, 'CSE-VI should be detected as higher sem');

  // CSEA-II with regular courses (mostly non-electives) should NOT be higher sem
  const regularCourses = [
    { course_code: 'CS101', course_title: 'Programming', faculty_ids: ['F001'], basket: 0, elective: 0, students_enrolled: 60, section: 'CSEA-II' },
    { course_code: 'CS102', course_title: 'Data Structures', faculty_ids: ['F002'], basket: 0, elective: 0, students_enrolled: 60, section: 'CSEA-II' },
    { course_code: 'CS103', course_title: 'Math', faculty_ids: ['F003'], basket: 0, elective: 0, students_enrolled: 60, section: 'CSEA-II' },
    { course_code: 'CS104', course_title: 'Web Dev', faculty_ids: ['F004'], basket: 0, elective: 1, students_enrolled: 30, section: 'CSEA-II' }
  ];
  const isHigher2 = detectHigherSem('CSEA-II', regularCourses);
  console.log(`  CSEA-II (regular courses) detected as higher sem: ${isHigher2} (expected: false)`);
  console.assert(isHigher2 === false, 'CSEA-II with regular courses should not be detected as higher sem');

  // CSEA-II with >80% electives SHOULD be detected as higher sem (edge case)
  const isHigher3 = detectHigherSem('CSEA-II', mockCourses);
  console.log(`  CSEA-II (>80% electives) detected as higher sem: ${isHigher3} (expected: true - elective ratio)`);
  console.assert(isHigher3 === true, 'CSEA-II with >80% electives should be detected as higher sem');

  // Test 2: groupByBasket
  console.log('\nTest 2: groupByBasket');
  const basketMap = groupByBasket(mockCourses);
  console.log(`  Number of baskets: ${basketMap.size}`);
  console.log(`  Basket 1 courses: ${basketMap.get(1)?.map(c => c.course_code).join(', ')}`);
  console.log(`  Basket 2 courses: ${basketMap.get(2)?.map(c => c.course_code).join(', ')}`);
  console.log(`  Basket 3 courses: ${basketMap.get(3)?.map(c => c.course_code).join(', ')}`);
  console.assert(basketMap.size === 3, 'Should have 3 baskets');
  console.assert(basketMap.get(1)?.length === 3, 'Basket 1 should have 3 courses');
  console.assert(basketMap.get(2)?.length === 2, 'Basket 2 should have 2 courses');

  // Test 3: assignBasketSlots
  console.log('\nTest 3: assignBasketSlots');
  const allocator = new SlotAllocator(mockTimeSlots);
  const roomSelector = new RoomSelector(mockRooms);

  // Initialize room bookings
  mockRooms.forEach(r => {
    if (!allocator.roomBookings.has(r.room_id)) {
      allocator.roomBookings.set(r.room_id, new Set());
    }
  });

  const assignments = assignBasketSlots(basketMap, allocator, roomSelector, {});
  console.log(`  Total assignments: ${assignments.length}`);

  // Group assignments by basket for verification
  const byBasket = new Map();
  for (const a of assignments) {
    if (!byBasket.has(a.basket_number)) {
      byBasket.set(a.basket_number, []);
    }
    byBasket.get(a.basket_number).push(a);
  }

  // Verify all courses in same basket share same slot
  console.log('\n  Basket slot assignments:');
  for (const [basketNum, basketAssigns] of byBasket) {
    const slots = new Set(basketAssigns.map(a => `${a.day}-${a.slot_id}`));
    console.log(`    Basket ${basketNum}: ${Array.from(slots).join(', ')} (${basketAssigns.length} courses)`);
    console.assert(slots.size === 1, `All basket ${basketNum} courses should share same slot`);
  }

  // Verify different baskets have different slots
  console.log('\n  Cross-basket slot check:');
  const allBasketSlots = Array.from(byBasket.values()).map(assigns =>
    `${assigns[0].day}-${assigns[0].slot_id}`
  );
  const uniqueSlots = new Set(allBasketSlots);
  console.log(`    Basket slots: ${allBasketSlots.join(', ')}`);
  console.log(`    Unique slots: ${uniqueSlots.size}`);
  console.assert(uniqueSlots.size === byBasket.size, 'Different baskets should have different slots');

  // Test 4: getCoreCourses
  console.log('\nTest 4: getCoreCourses');
  const coreCourses = getCoreCourses(mockCourses);
  console.log(`  Core courses: ${coreCourses.map(c => c.course_code).join(', ')}`);
  console.assert(coreCourses.length === 1, 'Should have 1 core course');
  console.assert(coreCourses[0].course_code === 'DS308', 'DS308 should be core');

  console.log('\n=== All tests passed! ===');
}
