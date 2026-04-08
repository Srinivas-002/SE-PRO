/**
 * timeSlotGenerator.js - Dynamic time slot generator
 */

/**
 * Generate time slots based on configuration
 * @param {Object} config - Time slot configuration
 * @param {string} config.startTime - Start time in HH:MM format (e.g., "09:00")
 * @param {string} config.endTime - End time in HH:MM format (e.g., "18:00")
 * @param {number} config.periodDuration - Minutes per class period (default: 55)
 * @param {number} config.breakAfterPeriod - Insert lunch after this many periods (default: 4)
 * @param {number} config.lunchDuration - Lunch break duration in minutes (default: 60)
 * @param {number} config.shortBreakDuration - Gap between periods in minutes (default: 5)
 * @returns {Object} { days: string[], slots: Array, breakSlots: Array }
 */
function generateTimeSlots(config) {
  const {
    startTime = "09:00",
    endTime = "18:00",
    periodDuration = 55,
    breakAfterPeriod = 4,
    lunchDuration = 60,
    shortBreakDuration = 5
  } = config;

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const slots = [];
  const breakSlots = [];

  // Parse start time
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  let currentMinutes = startMinutes;
  let slotId = 1;
  let periodsSinceLunch = 0;

  while (currentMinutes < endMinutes) {
    // Check if we need to insert lunch break
    if (periodsSinceLunch >= breakAfterPeriod) {
      // Insert lunch break
      const lunchEndMinutes = currentMinutes + lunchDuration;

      // Only add lunch if it fits before end time
      if (lunchEndMinutes <= endMinutes) {
        breakSlots.push(slotId);
        slots.push({
          id: slotId,
          label: "Lunch Break",
          start: formatTime(currentMinutes),
          end: formatTime(lunchEndMinutes),
          is_break: true
        });
        slotId++;
        currentMinutes = lunchEndMinutes;
        periodsSinceLunch = 0;
        continue;
      }
    }

    // Calculate period end time
    const periodEndMinutes = currentMinutes + periodDuration;

    // Check if period fits before end time
    if (periodEndMinutes > endMinutes) {
      break; // Not enough time for another period
    }

    // Add the period slot
    slots.push({
      id: slotId,
      label: `${formatTime(currentMinutes)}-${formatTime(periodEndMinutes)}`,
      start: formatTime(currentMinutes),
      end: formatTime(periodEndMinutes),
      is_break: false
    });
    slotId++;

    // Move current time forward by period duration + short break
    currentMinutes = periodEndMinutes + shortBreakDuration;
    periodsSinceLunch++;
  }

  return { days, slots, breakSlots };
}

/**
 * Format minutes since midnight to HH:MM string
 * @param {number} totalMinutes - Minutes since midnight
 * @returns {string} Time in H:MM format (e.g., "9:00", "1:00")
 */
function formatTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  // Use 12-hour format without leading zero for hours
  const displayHours = hours === 0 ? 12 : (hours > 12 ? hours - 12 : hours);
  const displayMinutes = minutes.toString().padStart(2, '0');

  return `${displayHours}:${displayMinutes}`;
}

module.exports = {
  generateTimeSlots,
  formatTime
};

// Test code - runs only when executed directly
if (require.main === module) {
  console.log('=== Time Slot Generator Tests ===\n');

  // Test 1: Default configuration
  console.log('Test 1: Default configuration (55 min periods, lunch after 4)');
  const config1 = {
    startTime: "09:00",
    endTime: "18:00",
    periodDuration: 55,
    breakAfterPeriod: 4,
    lunchDuration: 60,
    shortBreakDuration: 5
  };
  const result1 = generateTimeSlots(config1);
  console.log(`Days: ${result1.days.join(', ')}`);
  console.log(`Total slots: ${result1.slots.length}`);
  console.log(`Break slots: ${result1.breakSlots.join(', ')}`);
  console.log('Slots:');
  result1.slots.forEach(s => {
    console.log(`  ${s.id}: ${s.label}${s.is_break ? ' (BREAK)' : ''}`);
  });

  // Test 2: 50 minute periods
  console.log('\nTest 2: 50 minute periods');
  const config2 = {
    startTime: "09:00",
    endTime: "18:00",
    periodDuration: 50,
    breakAfterPeriod: 4,
    lunchDuration: 60,
    shortBreakDuration: 5
  };
  const result2 = generateTimeSlots(config2);
  console.log(`Total slots: ${result2.slots.length}`);
  console.log('Slots:');
  result2.slots.forEach(s => {
    console.log(`  ${s.id}: ${s.label}${s.is_break ? ' (BREAK)' : ''}`);
  });

  // Test 3: Early dismissal
  console.log('\nTest 3: Early dismissal (9:00-14:00)');
  const config3 = {
    startTime: "09:00",
    endTime: "14:00",
    periodDuration: 55,
    breakAfterPeriod: 3,
    lunchDuration: 45,
    shortBreakDuration: 5
  };
  const result3 = generateTimeSlots(config3);
  console.log(`Total slots: ${result3.slots.length}`);
  console.log('Slots:');
  result3.slots.forEach(s => {
    console.log(`  ${s.id}: ${s.label}${s.is_break ? ' (BREAK)' : ''}`);
  });

  console.log('\n=== All tests complete! ===');
}
