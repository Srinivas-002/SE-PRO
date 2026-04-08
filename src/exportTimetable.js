/**
 * exportTimetable.js - Exports timetable to Excel using ExcelJS
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs-extra');

// Preset palette of 15 colors for courses
const COLOR_PALETTE = [
  'FFB3BA', // Light pink
  'FFDFBA', // Light peach
  'FFFFBA', // Light yellow
  'BAFFCB', // Light green
  'BAE1FF', // Light blue
  'E2BAFF', // Light purple
  'FFBAE1', // Light magenta
  'FFA07A', // Light salmon
  '98FB98', // Pale green
  '87CEEB', // Sky blue
  'DDA0DD', // Plum
  'F0E68C', // Khaki
  'FFD700', // Gold
  'FF6347', // Tomato
  '9370DB'  // Medium purple
];

/**
 * Generate a consistent color for a course code
 * @param {string} courseCode
 * @returns {string} Hex color code
 */
function getColorForCourse(courseCode) {
  // Use hash of course code to pick consistent color
  let hash = 0;
  for (let i = 0; i < courseCode.length; i++) {
    hash = courseCode.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLOR_PALETTE.length;
  return COLOR_PALETTE[index];
}

/**
 * Export timetable entries to Excel
 * @param {Array} entries - Timetable entries from generateTimetable
 * @param {Object} timeSlots - Time slots config
 * @param {string} outputPath - Path to save the Excel file
 * @returns {Promise<string>} Path to saved file
 */
async function exportTimetable(entries, timeSlots, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Timetable Generator';
  workbook.created = new Date();

  // Get unique sections
  const sections = [...new Set(entries.map(e => e.section))].sort();

  // Get slot labels (only non-break slots)
  const slotLabels = timeSlots.slots.map(s => s.label);
  const slotIds = timeSlots.slots.map(s => s.id);

  // Days in order
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  // Create Summary sheet FIRST (at the start)
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.getRow(1).values = ['Section', 'Total Courses', 'Total Weekly Hours', 'Shared Faculty Courses'];
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  // Calculate summary data per section
  const sectionSummary = new Map();
  const facultyCoursesMap = new Map(); // faculty_id -> Set of course_codes

  for (const section of sections) {
    const sectionEntries = entries.filter(e => e.section === section);
    const uniqueCourses = new Set(sectionEntries.map(e => e.course_code));

    // Count weekly hours (L+T+P per course, but we count entries)
    // Each entry represents 1 hour (L/T) or 2 hours (P counted as 1 entry but 2 slots)
    let totalHours = 0;
    for (const entry of sectionEntries) {
      if (entry.type === 'P') {
        totalHours += 2; // P is 2-hour block
      } else {
        totalHours += 1;
      }
    }

    // Track faculty and their courses for shared faculty detection
    for (const entry of sectionEntries) {
      if (!facultyCoursesMap.has(entry.faculty_id)) {
        facultyCoursesMap.set(entry.faculty_id, new Set());
      }
      facultyCoursesMap.get(entry.faculty_id).add(`${entry.course_code}|${entry.section}`);
    }

    sectionSummary.set(section, {
      totalCourses: uniqueCourses.size,
      totalHours
    });
  }

  // Find sections with shared faculty (same faculty teaching in multiple sections)
  const sharedFacultyCourses = new Set();
  for (const [facultyId, courses] of facultyCoursesMap) {
    const sectionsSet = new Set();
    for (const courseSection of courses) {
      const [, section] = courseSection.split('|');
      sectionsSet.add(section);
    }
    if (sectionsSet.size > 1) {
      // This faculty teaches in multiple sections
      for (const courseSection of courses) {
        sharedFacultyCourses.add(courseSection);
      }
    }
  }

  // Fill summary rows
  let summaryRowIdx = 2;
  for (const section of sections) {
    const summary = sectionSummary.get(section);
    const row = summarySheet.getRow(summaryRowIdx);
    const hasSharedFaculty = [...facultyCoursesMap.entries()].some(([fid, courses]) => {
      const sectionsForThisFaculty = new Set([...courses].map(c => c.split('|')[1]));
      return sectionsForThisFaculty.has(section) && sectionsForThisFaculty.size > 1;
    });

    row.values = [
      section,
      summary.totalCourses,
      summary.totalHours,
      hasSharedFaculty ? 'Yes' : 'No'
    ];
    row.alignment = { vertical: 'middle', horizontal: 'center' };
    row.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
    summaryRowIdx++;
  }

  // Set column widths for summary
  summarySheet.getColumn(1).width = 15;
  summarySheet.getColumn(2).width = 15;
  summarySheet.getColumn(3).width = 20;
  summarySheet.getColumn(4).width = 20;

  // Create a sheet for each section (after Summary)
  for (const section of sections) {
    const sheet = workbook.addWorksheet(section);

    // Set up header row
    sheet.getRow(1).values = ['Day \\ Slot', ...slotLabels];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Set column widths
    sheet.getColumn(1).width = 12;
    for (let i = 2; i <= slotLabels.length + 1; i++) {
      sheet.getColumn(i).width = 18;
    }

    // Create day rows
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
      const day = days[dayIndex];
      const row = sheet.getRow(dayIndex + 2);
      row.values = [day, ...Array(slotLabels.length).fill('')];
      row.alignment = { vertical: 'middle', horizontal: 'center' };
      row.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    }

    // Filter entries for this section
    const sectionEntries = entries.filter(e => e.section === section);

    // Track which cells are filled (for lab merging)
    const filledCells = new Set();

    // Fill in the timetable
    for (const entry of sectionEntries) {
      const dayIndex = days.indexOf(entry.day);
      if (dayIndex === -1) continue;

      const row = dayIndex + 2;

      // Handle single slot or multiple slots (lab)
      const slots = Array.isArray(entry.slot_id) ? entry.slot_id : [entry.slot_id];

      for (let i = 0; i < slots.length; i++) {
        const slotId = slots[i];
        const slotIndex = slotIds.indexOf(slotId);
        if (slotIndex === -1) continue;

        const col = slotIndex + 2; // +2 because col 1 is day name
        const cellKey = `${row}-${col}`;

        if (filledCells.has(cellKey)) continue;

        const cell = sheet.getCell(row, col);
        cell.value = `${entry.course_code}\n${entry.faculty_id}\n${entry.room_name}`;

        // Apply color for this course
        const color = getColorForCourse(entry.course_code);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${color}` }
        };

        // If this is a lab (multiple slots), merge cells
        if (slots.length > 1 && i === 0) {
          const nextSlotIndex = slotIds.indexOf(slots[1]);
          if (nextSlotIndex === slotIndex + 1) {
            // Consecutive slots - merge
            sheet.mergeCells(row, col, row, col + 1);
            filledCells.add(`${row}-${col + 1}`);
          }
        }

        filledCells.add(cellKey);
      }
    }

    // Apply borders to all cells
    for (let row = 1; row <= days.length + 1; row++) {
      for (let col = 1; col <= slotLabels.length + 1; col++) {
        const cell = sheet.getCell(row, col);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }

    // Freeze first row and first column
    sheet.views = [
      {
        state: 'frozen',
        xSplit: 1,
        ySplit: 1
      }
    ];
  }

  // Create Legend sheet
  const legendSheet = workbook.addWorksheet('Legend');

  // Header
  legendSheet.getRow(1).values = ['Course Code', 'Course Name', 'Faculty', 'Sessions per week', 'Room Requirements', 'Color'];
  legendSheet.getRow(1).font = { bold: true };
  legendSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  legendSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  // Get unique courses with room requirements
  const courseMap = new Map();
  for (const entry of entries) {
    const key = entry.course_code;
    if (!courseMap.has(key)) {
      courseMap.set(key, {
        course_code: entry.course_code,
        course_name: entry.course_name,
        faculty_id: entry.faculty_id,
        sessions: 0,
        room_requirements: entry.room_requirements || [],
        color: getColorForCourse(entry.course_code)
      });
    }
    courseMap.get(key).sessions += 1;
  }

  // Fill legend rows
  let rowIdx = 2;
  for (const course of courseMap.values()) {
    const row = legendSheet.getRow(rowIdx);
    const roomReqStr = course.room_requirements.length > 0
      ? course.room_requirements.join(', ')
      : '-';
    row.values = [course.course_code, course.course_name, course.faculty_id, course.sessions, roomReqStr, ''];

    // Add color indicator
    const colorCell = legendSheet.getCell(rowIdx, 6);
    colorCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${course.color}` }
    };

    rowIdx++;
  }

  // Set column widths for legend
  legendSheet.getColumn(1).width = 15;
  legendSheet.getColumn(2).width = 30;
  legendSheet.getColumn(3).width = 15;
  legendSheet.getColumn(4).width = 20;
  legendSheet.getColumn(5).width = 20;
  legendSheet.getColumn(6).width = 10;

  // Ensure output directory exists
  await fs.ensureDir(path.dirname(outputPath));

  // Write the file
  await workbook.xlsx.writeFile(outputPath);

  return outputPath;
}

module.exports = {
  exportTimetable
};

// Test code
if (require.main === module) {
  console.log('=== Export Timetable Test ===\n');

  const { generateTimetable } = require('./timetable');
  const { loadRooms, loadFaculty, loadTimeSlots, loadAllCourses } = require('./dataLoader');

  (async () => {
    try {
      const rooms = await loadRooms();
      const faculty = await loadFaculty();
      const timeSlots = await loadTimeSlots();
      const courses = await loadAllCourses();

      console.log('Generating timetable...');
      const timetable = generateTimetable(courses, rooms, timeSlots);

      console.log(`Generated ${timetable.length} entries`);

      const outputPath = path.join(__dirname, '..', 'outputs', 'Timetable.xlsx');
      console.log(`\nExporting to ${outputPath}...`);

      await exportTimetable(timetable, timeSlots, outputPath);

      console.log('✓ Excel file created successfully!');
      console.log(`  Location: ${outputPath}`);
    } catch (error) {
      console.error('Error:', error.message);
      console.error(error.stack);
    }
  })();
}
