/**
 * RoomSelector - Utility for selecting appropriate rooms based on session type
 * Uses real room capacities (48/120/240) and facility matching
 */
class RoomSelector {
  /**
   * @param {Array} rooms - Array of { room_id, name, capacity, type, equipment }
   */
  constructor(rooms) {
    // Separate rooms into categories based on capacity and type
    this.labs48 = [];
    this.classrooms48 = [];
    this.halls120 = [];
    this.halls240 = [];

    for (const room of rooms) {
      const normalizedType = this._normalizeRoomType(room.type);
      const capacity = room.capacity;

      if (normalizedType === 'lab') {
        this.labs48.push(room);
      } else if (normalizedType === 'classroom') {
        this.classrooms48.push(room);
      } else if (normalizedType === 'hall') {
        if (capacity >= 200) {
          this.halls240.push(room);
        } else {
          this.halls120.push(room);
        }
      }
    }

    // Sort each category by room_id for consistent ordering
    this.labs48.sort((a, b) => a.room_id.localeCompare(b.room_id));
    this.classrooms48.sort((a, b) => a.room_id.localeCompare(b.room_id));
    this.halls120.sort((a, b) => a.room_id.localeCompare(b.room_id));
    this.halls240.sort((a, b) => a.room_id.localeCompare(b.room_id));

    // Booking map: Map<"day-slot", Set<room_id>>
    this.bookings = new Map();
  }

  /**
   * Normalize room type to lowercase base type
   * @param {string} type - Raw room type from CSV
   * @returns {string} Normalized type: 'classroom', 'lab', or 'hall'
   */
  _normalizeRoomType(type) {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('classroom')) return 'classroom';
    if (lowerType.includes('lab')) return 'lab';
    if (lowerType.includes('hall')) return 'hall';
    // Handle "120-Seater Hall" and "240-Seater Hall" types
    if (lowerType.includes('seater')) return 'hall';
    return lowerType; // fallback
  }

  /**
   * Create a day-slot key
   * @param {string} day
   * @param {number} slotId
   * @returns {string}
   */
  _makeKey(day, slotId) {
    return `${day}-${slotId}`;
  }

  /**
   * Get or create booked rooms set for a slot
   * @param {string} key
   * @returns {Set<string>}
   */
  _getBookedRooms(key) {
    if (!this.bookings.has(key)) {
      this.bookings.set(key, new Set());
    }
    return this.bookings.get(key);
  }

  /**
   * Check if a room is booked for a given slot
   * @param {string} roomId
   * @param {string} day
   * @param {number} slotId
   * @returns {boolean}
   */
  isRoomBooked(roomId, day, slotId) {
    const key = this._makeKey(day, slotId);
    return this._getBookedRooms(key).has(roomId);
  }

  /**
   * Get room tier based on enrolled students
   * @param {number} enrolledCount - Number of enrolled students
   * @returns {string} 'small' (48), 'medium' (120), or 'large' (240)
   */
  getRoomTier(enrolledCount) {
    if (enrolledCount <= 48 || enrolledCount === 0) {
      return 'small';  // 48-cap room
    } else if (enrolledCount <= 120) {
      return 'medium'; // 120-cap hall
    } else {
      return 'large';  // 240-cap hall
    }
  }

  /**
   * Get lab preference based on course title keywords
   * @param {string} courseTitle - Course title
   * @returns {string|null} 'Computers', 'Hardware', or null
   */
  getLabPreference(courseTitle) {
    if (!courseTitle) return null;
    const title = courseTitle.toLowerCase();

    // Computers lab keywords
    const computersKeywords = [
      'computer', 'programming', 'software', 'data', 'algorithm',
      'database', 'web', 'cloud', 'ai', 'ml', 'machine learning',
      'deep learning', 'nlp', 'virtualisation', 'security', 'privacy',
      'architecture', 'gpu', 'distributed', 'parallel'
    ];

    // Hardware lab keywords
    const hardwareKeywords = [
      'hardware', 'circuit', 'embedded', 'iot', 'sensor', 'device',
      'vlsi', 'rf', 'analog', 'digital', 'fpga', 'microcontroller',
      'electronics', 'power', 'energy', 'communication', 'wireless',
      'network', 'signal', 'image', 'vision', 'robotics', 'automation'
    ];

    for (const keyword of computersKeywords) {
      if (title.includes(keyword)) {
        return 'Computers';
      }
    }

    for (const keyword of hardwareKeywords) {
      if (title.includes(keyword)) {
        return 'Hardware';
      }
    }

    return null; // No preference
  }

  /**
   * Check if room has required facility
   * @param {Array<string>} roomFacilities - Room's facilities list
   * @param {string} requiredFacility - Required facility (e.g., 'Computers')
   * @returns {boolean}
   */
  _hasFacility(roomFacilities, requiredFacility) {
    if (!roomFacilities || !requiredFacility) return true;
    return roomFacilities.some(f =>
      f.toLowerCase().includes(requiredFacility.toLowerCase())
    );
  }

  /**
   * Find an appropriate room based on session type and enrolled students
   * @param {string} sessionType - 'L', 'T', or 'P'
   * @param {number} enrolledCount - Number of enrolled students
   * @param {string} courseTitle - Course title for lab preference
   * @param {string} day - Day name
   * @param {number} slotId - Slot ID
   * @param {string} courseCode - Course code for logging
   * @returns {{ room_id, name, capacity, type } | null}
   */
  findRoom(sessionType, enrolledCount, courseTitle, day, slotId, courseCode = '') {
    const key = this._makeKey(day, slotId);
    const bookedRooms = this._getBookedRooms(key);

    if (sessionType === 'P') {
      // Practical sessions require a lab
      const labPreference = this.getLabPreference(courseTitle);

      // Filter labs that are not booked
      const availableLabs = this.labs48.filter(room =>
        !bookedRooms.has(room.room_id)
      );

      if (availableLabs.length === 0) {
        console.error(`No lab available for ${courseCode} at ${day} slot ${slotId}`);
        return null;
      }

      // If there's a preference, try to find matching lab first
      if (labPreference) {
        const matchingLabs = availableLabs.filter(room =>
          this._hasFacility(room.facilities, labPreference)
        );
        if (matchingLabs.length > 0) {
          return matchingLabs[0];
        }
        // No matching lab, fall through to any available lab
        console.warn(`No ${labPreference} lab available for ${courseCode}, using any lab`);
      }

      // Return any available lab
      return availableLabs[0];
    }

    if (sessionType === 'L' || sessionType === 'T') {
      const tier = this.getRoomTier(enrolledCount);
      let candidates = [];
      let usedTier = tier;

      // Select candidate pool based on tier
      if (tier === 'small') {
        candidates = this.classrooms48;
      } else if (tier === 'medium') {
        candidates = this.halls120;
      } else { // large
        candidates = this.halls240;
      }

      // Filter out booked rooms
      let available = candidates.filter(room =>
        !bookedRooms.has(room.room_id)
      );

      // If no room available in current tier, bump up
      if (available.length === 0) {
        if (tier === 'small') {
          // Bump to medium (halls120)
          usedTier = 'medium';
          available = this.halls120.filter(room =>
            !bookedRooms.has(room.room_id)
          );
          if (available.length === 0) {
            // Bump to large (halls240)
            usedTier = 'large';
            available = this.halls240.filter(room =>
              !bookedRooms.has(room.room_id)
            );
          }
        } else if (tier === 'medium') {
          // Bump to large (halls240)
          usedTier = 'large';
          available = this.halls240.filter(room =>
            !bookedRooms.has(room.room_id)
          );
        }
        // If still no room, return null
      }

      if (available.length === 0) {
        console.error(`No room available for ${courseCode} at ${day} slot ${slotId} (tier: ${tier}, bumped to: ${usedTier})`);
        return null;
      }

      // Log warning if bumped up
      if (usedTier !== tier) {
        console.warn(`No room in ${tier} tier for ${courseCode}, bumped to ${usedTier}`);
      }

      // Log warning if using hall for small class
      if (usedTier !== 'small' && enrolledCount <= 48 && enrolledCount > 0) {
        console.warn(`Hall assigned for ${courseCode} with ${enrolledCount} students (should use classroom)`);
      }

      return available[0];
    }

    return null;
  }

  /**
   * Book a room for a specific slot
   * @param {string} roomId
   * @param {string} day
   * @param {number} slotId
   */
  bookRoom(roomId, day, slotId) {
    const key = this._makeKey(day, slotId);
    this._getBookedRooms(key).add(roomId);
  }

  /**
   * Release a booked room (for rollback)
   * @param {string} roomId
   * @param {string} day
   * @param {number} slotId
   */
  releaseRoom(roomId, day, slotId) {
    const key = this._makeKey(day, slotId);
    const bookedRooms = this.bookings.get(key);
    if (bookedRooms) {
      bookedRooms.delete(roomId);
      if (bookedRooms.size === 0) {
        this.bookings.delete(key);
      }
    }
  }

  /**
   * Get all bookings for a slot
   * @param {string} day
   * @param {number} slotId
   * @returns {Array<string>} Array of booked room_ids
   */
  getBookingsForSlot(day, slotId) {
    const key = this._makeKey(day, slotId);
    return Array.from(this._getBookedRooms(key));
  }

  /**
   * Get booking summary
   * @returns {Object} Summary of all bookings
   */
  getBookingSummary() {
    const summary = {};
    for (const [key, rooms] of this.bookings) {
      summary[key] = Array.from(rooms);
    }
    return summary;
  }

  /**
   * Get room counts by category
   * @returns {Object} Room counts
   */
  getRoomCounts() {
    return {
      labs48: this.labs48.length,
      classrooms48: this.classrooms48.length,
      halls120: this.halls120.length,
      halls240: this.halls240.length
    };
  }
}

// Test code - runs only when executed directly
if (require.main === module) {
  console.log('=== RoomSelector Tests (Real Capacity Tiers) ===\n');

  // Real rooms from data
  const realRooms = [
    { room_id: 'C101', name: 'Room C101', capacity: 48, type: 'Classroom', facilities: ['Whiteboard', 'Display Screen'] },
    { room_id: 'C102', name: 'Room C102', capacity: 48, type: 'Classroom', facilities: ['Whiteboard', 'Display Screen'] },
    { room_id: 'C104', name: 'Room C104', capacity: 48, type: 'Classroom', facilities: ['Whiteboard', 'Display Screen'] },
    { room_id: 'L105', name: 'Lab L105', capacity: 48, type: 'Lab', facilities: ['Hardware', 'Whiteboard'] },
    { room_id: 'L106', name: 'Lab L106', capacity: 48, type: 'Lab', facilities: ['Computers', 'Whiteboard'] },
    { room_id: 'L107', name: 'Lab L107', capacity: 48, type: 'Lab', facilities: ['Computers', 'Whiteboard'] },
    { room_id: 'C002', name: 'Hall C002', capacity: 120, type: '120-Seater Hall', facilities: ['Projector', 'Whiteboard'] },
    { room_id: 'C003', name: 'Hall C003', capacity: 120, type: '120-Seater Hall', facilities: ['Projector', 'Whiteboard'] },
    { room_id: 'C004', name: 'Hall C004', capacity: 240, type: '240-Seater Hall', facilities: ['Projector', 'Whiteboard'] }
  ];

  const selector = new RoomSelector(realRooms);
  const counts = selector.getRoomCounts();
  console.log('Room counts:', counts);
  console.assert(counts.labs48 === 3, 'Should have 3 labs');
  console.assert(counts.classrooms48 === 3, 'Should have 3 classrooms');
  console.assert(counts.halls120 === 2, 'Should have 2 halls-120');
  console.assert(counts.halls240 === 1, 'Should have 1 hall-240');

  // Test 1: Small class (<=48) gets classroom
  console.log('\nTest 1: 35 students → 48-cap classroom');
  const room1 = selector.findRoom('L', 35, 'Programming Fundamentals', 'Monday', 1, 'CS101');
  console.log(`  Found: ${room1?.name} (capacity ${room1?.capacity})`);
  console.assert(room1?.capacity === 48, 'Should return 48-cap room');
  console.assert(room1?.room_id.startsWith('C'), 'Should return classroom');

  // Test 2: Medium class (49-120) gets 120-cap hall
  console.log('\nTest 2: 98 students → 120-cap hall');
  const selector2 = new RoomSelector(realRooms);
  const room2 = selector2.findRoom('L', 98, 'Full Stack Development', 'Monday', 1, 'DA352');
  console.log(`  Found: ${room2?.name} (capacity ${room2?.capacity})`);
  console.assert(room2?.capacity === 120, 'Should return 120-cap hall');

  // Test 3: Large class (>120) gets 240-cap hall
  console.log('\nTest 3: 120 students → 120-cap hall');
  const selector3 = new RoomSelector(realRooms);
  const room3 = selector3.findRoom('L', 120, 'NLP', 'Monday', 1, 'CS458');
  console.log(`  Found: ${room3?.name} (capacity ${room3?.capacity})`);
  console.assert(room3?.capacity === 120, 'Should return 120-cap hall');

  // Test 4: 0 enrolled gets smallest room
  console.log('\nTest 4: 0 enrolled → 48-cap room');
  const selector4 = new RoomSelector(realRooms);
  const room4 = selector4.findRoom('L', 0, 'Empty Course', 'Monday', 1, 'EC363');
  console.log(`  Found: ${room4?.name} (capacity ${room4?.capacity})`);
  console.assert(room4?.capacity === 48, 'Should return 48-cap room for 0 enrolled');

  // Test 5: Lab with Computers preference
  console.log('\nTest 5: Programming course → Computers lab');
  const selector5 = new RoomSelector(realRooms);
  const lab5 = selector5.findRoom('P', 30, 'Data Structures Programming', 'Monday', 1, 'CS163');
  console.log(`  Found: ${lab5?.name} (facilities: ${lab5?.facilities?.join(', ')})`);
  console.assert(lab5?.facilities?.includes('Computers'), 'Should return Computers lab');

  // Test 6: Lab with Hardware preference
  console.log('\nTest 6: Hardware course → Hardware lab');
  const selector6 = new RoomSelector(realRooms);
  const lab6 = selector6.findRoom('P', 30, 'Embedded Systems and IoT', 'Monday', 1, 'EC201');
  console.log(`  Found: ${lab6?.name} (facilities: ${lab6?.facilities?.join(', ')})`);
  console.assert(lab6?.facilities?.includes('Hardware'), 'Should return Hardware lab');

  // Test 7: Book room and verify exclusion
  console.log('\nTest 7: Book room and verify exclusion');
  const selector7 = new RoomSelector(realRooms);
  selector7.bookRoom('C101', 'Monday', 1);
  const room7 = selector7.findRoom('L', 35, 'Test Course', 'Monday', 1, 'TEST1');
  console.log(`  Found: ${room7?.name} (capacity ${room7?.capacity})`);
  console.assert(room7?.room_id !== 'C101', 'Should not return booked room');

  // Test 8: Bump to next tier when classroom full
  console.log('\nTest 8: Bump to hall when classrooms full');
  const selector8 = new RoomSelector(realRooms);
  // Book all classrooms
  selector8.bookRoom('C101', 'Tuesday', 1);
  selector8.bookRoom('C102', 'Tuesday', 1);
  selector8.bookRoom('C104', 'Tuesday', 1);
  const room8 = selector8.findRoom('L', 35, 'Test Course', 'Tuesday', 1, 'TEST2');
  console.log(`  Found: ${room8?.name} (capacity ${room8?.capacity})`);
  console.assert(room8?.capacity === 120, 'Should bump to 120-cap hall');

  // Test 9: Lab preference fallback
  console.log('\nTest 9: Lab preference fallback');
  const selector9 = new RoomSelector(realRooms);
  // Book all Computers labs
  selector9.bookRoom('L106', 'Wednesday', 1);
  selector9.bookRoom('L107', 'Wednesday', 1);
  const lab9 = selector9.findRoom('P', 30, 'Programming Course', 'Wednesday', 1, 'TEST3');
  console.log(`  Found: ${lab9?.name} (facilities: ${lab9?.facilities?.join(', ')})`);
  console.assert(lab9 !== null, 'Should return Hardware lab as fallback');

  // Test 10: getRoomTier
  console.log('\nTest 10: getRoomTier function');
  console.log(`  0 students → ${selector.getRoomTier(0)} (expected: small)`);
  console.log(`  48 students → ${selector.getRoomTier(48)} (expected: small)`);
  console.log(`  49 students → ${selector.getRoomTier(49)} (expected: medium)`);
  console.log(`  120 students → ${selector.getRoomTier(120)} (expected: medium)`);
  console.log(`  121 students → ${selector.getRoomTier(121)} (expected: large)`);
  console.assert(selector.getRoomTier(0) === 'small', '0 should be small');
  console.assert(selector.getRoomTier(48) === 'small', '48 should be small');
  console.assert(selector.getRoomTier(49) === 'medium', '49 should be medium');
  console.assert(selector.getRoomTier(120) === 'medium', '120 should be medium');
  console.assert(selector.getRoomTier(121) === 'large', '121 should be large');

  // Test 11: getLabPreference
  console.log('\nTest 11: getLabPreference function');
  console.log(`  "Data Structures" → ${selector.getLabPreference('Data Structures')} (expected: Computers)`);
  console.log(`  "Embedded IoT" → ${selector.getLabPreference('Embedded IoT')} (expected: Hardware)`);
  console.log(`  "Mathematics" → ${selector.getLabPreference('Mathematics')} (expected: null)`);
  console.assert(selector.getLabPreference('Data Structures') === 'Computers', 'Data Structures → Computers');
  console.assert(selector.getLabPreference('Embedded IoT') === 'Hardware', 'Embedded IoT → Hardware');
  console.assert(selector.getLabPreference('Mathematics') === null, 'Mathematics → null');

  console.log('\n=== All tests passed! ===');
}

module.exports = RoomSelector;
