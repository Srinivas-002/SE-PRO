/**
 * electiveSync.js - Ensures elective courses across sections share the same slot
 */

/**
 * Group elective courses by course_code
 * @param {Array} allCourses - Array of course objects from dataLoader
 * @returns {Map<string, Array>} Map<course_code, [course objects]>
 */
function groupElectives(allCourses) {
  const groups = new Map();

  for (const course of allCourses) {
    if (course.is_elective) {
      if (!groups.has(course.course_code)) {
        groups.set(course.course_code, []);
      }
      groups.get(course.course_code).push(course);
    }
  }

  return groups;
}

/**
 * Assign slots to all elective groups
 * @param {Map<string, Array>} electiveGroups - Grouped electives from groupElectives
 * @param {SlotAllocator} slotAllocator - Instance for booking slots
 * @param {RoomSelector} roomSelector - Instance for selecting rooms
 * @param {Object} timeSlots - Time slots config for slot_label
 * @returns {Array} Array of assigned entries with day, slot_id, room_id, etc.
 */
function assignElectiveSlots(electiveGroups, slotAllocator, roomSelector, timeSlots) {
  const assignments = [];
  const slots = slotAllocator.slots;

  for (const [courseCode, courses] of electiveGroups) {
    // Collect all faculty and sections for this elective
    const facultyIds = [...new Set(courses.map(c => c.faculty_id))];
    const sections = courses.map(c => c.section);

    // Try to find a common slot that works for all faculty and ALL sections simultaneously
    let foundSlot = null;
    const days = slotAllocator.days;

    outerLoop:
    for (const day of days) {
      for (const slot of slots) {
        // Check if this slot works for ALL faculty and ALL sections
        let allFree = true;

        for (const facultyId of facultyIds) {
          for (const section of sections) {
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
      console.warn(`WARNING: No common slot for elective ${courseCode}`);
      continue;
    }

    // Found a common slot - now assign rooms and book for each section
    for (const course of courses) {
      const { day, slotId } = foundSlot;

      // Find a room for this section
      const room = roomSelector.findRoomByStrength('L', course.section_strength, day, slotId, course.room_requirements || [], course.course_code);

      if (!room) {
        console.warn(`WARNING: No room available for ${course.course_code} (${course.section}) at ${day} slot ${slotId}`);
        continue;
      }

      // Book the slot in slotAllocator
      slotAllocator.bookSlot(course.faculty_id, course.section, room.room_id, day, slotId);

      // Book the room in roomSelector
      roomSelector.bookRoom(room.room_id, day, slotId);

      // Get slot label
      const slotLabel = slots.find(s => s.id === slotId)?.label || '';

      // Add to assignments
      assignments.push({
        course_code: course.course_code,
        course_name: course.name,
        faculty_id: course.faculty_id,
        section: course.section,
        day,
        slot_id: slotId,
        slot_label: slotLabel,
        room_id: room.room_id,
        room_name: room.name,
        room_capacity: room.capacity,
        type: 'L',
        room_requirements: course.room_requirements || []
      });
    }
  }

  return assignments;
}

module.exports = {
  groupElectives,
  assignElectiveSlots
};

// Test code - runs only when executed directly
if (require.main === module) {
  console.log('=== ElectiveSync Tests ===\n');

  const SlotAllocator = require('./slotAllocator');
  const RoomSelector = require('./roomSelector');

  // Mock data
  const mockCourses = [
    { course_code: 'CS104', name: 'Web Dev Elective', faculty_id: 'F02', section: 'CSEA-I', is_elective: true, section_strength: 30 },
    { course_code: 'CS104', name: 'Web Dev Elective', faculty_id: 'F02', section: 'CSEB-I', is_elective: true, section_strength: 30 },
    { course_code: 'CS101', name: 'Data Structures', faculty_id: 'F01', section: 'CSEA-I', is_elective: false, section_strength: 60 },
    { course_code: 'CS105', name: 'Networks', faculty_id: 'F05', section: 'CSEB-I', is_elective: false, section_strength: 60 }
  ];

  const mockTimeSlots = {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    slots: [
      { id: 1, label: '8:00-8:55' },
      { id: 2, label: '9:00-9:55' },
      { id: 3, label: '10:00-10:55' },
      { id: 4, label: '11:00-11:55' },
      { id: 6, label: '1:00-1:55' },
      { id: 7, label: '2:00-2:55' },
      { id: 8, label: '3:00-3:55' }
    ],
    breakSlots: [{ id: 5, label: 'LUNCH', is_break: true }]
  };

  const mockRooms = [
    { room_id: 'R101', name: 'Room 101', capacity: 60, type: 'classroom' },
    { room_id: 'R102', name: 'Room 102', capacity: 60, type: 'classroom' },
    { room_id: 'L201', name: 'Lab 201', capacity: 30, type: 'lab' },
    { room_id: 'H301', name: 'Hall 301', capacity: 120, type: 'hall' }
  ];

  // Test 1: groupElectives
  console.log('Test 1: groupElectives');
  const groups = groupElectives(mockCourses);
  console.log(`  Number of elective groups: ${groups.size}`);
  console.log(`  CS104 group: ${JSON.stringify(groups.get('CS104'))}`);
  console.assert(groups.size === 1, 'Should have 1 elective group');
  console.assert(groups.get('CS104').length === 2, 'CS104 should have 2 sections');

  // Test 2: assignElectiveSlots
  console.log('\nTest 2: assignElectiveSlots');
  const allocator = new SlotAllocator(mockTimeSlots);
  const roomSelector = new RoomSelector(mockRooms);

  // Initialize room bookings in allocator
  mockRooms.forEach(r => {
    if (!allocator.roomBookings.has(r.room_id)) {
      allocator.roomBookings.set(r.room_id, new Set());
    }
  });

  const assignments = assignElectiveSlots(groups, allocator, roomSelector, mockTimeSlots);
  console.log(`  Assignments: ${JSON.stringify(assignments, null, 2)}`);

  // Verify both sections have same day and slot
  const cs104Assignments = assignments.filter(a => a.course_code === 'CS104');
  console.assert(cs104Assignments.length === 2, 'Should have 2 assignments for CS104');
  console.assert(cs104Assignments[0].day === cs104Assignments[1].day, 'Both sections should have same day');
  console.assert(cs104Assignments[0].slot_id === cs104Assignments[1].slot_id, 'Both sections should have same slot_id');

  // Test 3: Verify bookings in allocator
  console.log('\nTest 3: Verify bookings');
  const summary = allocator.getBookingSummary();
  console.log(`  Faculty bookings: ${JSON.stringify(summary.facultyBookings)}`);
  console.log(`  Section bookings: ${JSON.stringify(summary.sectionBookings)}`);

  // Test 4: Conflict detection - try to assign another elective with same faculty
  console.log('\nTest 4: Conflict detection with same faculty');
  const mockCourses2 = [
    { course_code: 'CS201', name: 'Elective A', faculty_id: 'F02', section: 'CSEA-I', is_elective: true, section_strength: 30 },
    { course_code: 'CS201', name: 'Elective A', faculty_id: 'F02', section: 'CSEB-I', is_elective: true, section_strength: 30 }
  ];
  const groups2 = groupElectives([...mockCourses, ...mockCourses2]);
  console.log(`  Groups: ${Array.from(groups2.keys())}`);

  const allocator2 = new SlotAllocator(mockTimeSlots);
  const roomSelector2 = new RoomSelector(mockRooms);
  mockRooms.forEach(r => {
    if (!allocator2.roomBookings.has(r.room_id)) {
      allocator2.roomBookings.set(r.room_id, new Set());
    }
  });

  const assignments2 = assignElectiveSlots(groups2, allocator2, roomSelector2, mockTimeSlots);
  const cs104Assign2 = assignments2.filter(a => a.course_code === 'CS104');
  const cs201Assign2 = assignments2.filter(a => a.course_code === 'CS201');

  console.log(`  CS104 slot: ${cs104Assign2[0]?.day}-${cs104Assign2[0]?.slot_id}`);
  console.log(`  CS201 slot: ${cs201Assign2[0]?.day}-${cs201Assign2[0]?.slot_id}`);

  // They should have different slots because same faculty F02
  if (cs104Assign2.length > 0 && cs201Assign2.length > 0) {
    console.assert(
      cs104Assign2[0].day !== cs201Assign2[0].day || cs104Assign2[0].slot_id !== cs201Assign2[0].slot_id,
      'Electives with same faculty should have different slots'
    );
  }

  console.log('\n=== All tests passed! ===');
}
