# Timetable Generator - Academic Scheduling System

A comprehensive academic scheduling system that generates class timetables, exam schedules, and faculty timetables from CSV/JSON data files.

## Table of Contents

- [Installation](#installation)
- [Running the Application](#running-the-application)
- [Using the UI](#using-the-ui)
- [Input File Formats](#input-file-formats)
- [Output Files](#output-files)
- [API Endpoints](#api-endpoints)

---

## Installation

1. **Clone or download** the project

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Verify installation**:
   ```bash
   node app.js
   ```
   Server should start at `http://localhost:3000`

---

## Running the Application

### Start the Server

```bash
node app.js
```

The server will start on `http://localhost:3000`

### Access the UI

Open your browser and navigate to:
```
http://localhost:3000
```

---

## Using the UI

### Step 1: Upload Data Files

1. Navigate to the **Upload Data** section
2. Upload the required files:
   - `rooms.csv` - Room information
   - `faculty.csv` - Faculty information
   - `time_slots.json` - Time slot configuration
   - Course files (select multiple CSV files)
3. Click **Upload All**
4. Verify files appear in the "Uploaded Files" list

### Step 2: Generate Class Timetable

1. In the **Generate** section, find the "Class Timetable" card
2. Click **Generate**
3. Wait for processing (spinner will show)
4. Click **Download Excel File** to download the timetable
5. The Faculty Timetable button will be enabled after successful generation

### Step 3: Generate Exam Schedule

1. In the **Generate** section, find the "Exam Schedule" card
2. Set the **Start Date** for exams
3. Click **Generate**
4. Click **Download Excel File** to download the exam schedule

### Step 4: Generate Faculty Timetable

1. In the **Generate** section, find the "Faculty Timetable" card
2. Click **Generate** (enabled after class timetable is generated)
3. Click **Download Excel File** to download individual faculty timetables

### Step 5: Run Conflict Check

1. Scroll to the **Validation Report** section
2. Click **Run Conflict Check**
3. Review the validation results table for any conflicts or missing hours

---

## Input File Formats

### rooms.csv

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| room_id | String | Unique room identifier | R001 |
| name | String | Human-readable room name | Hall A |
| type | String | Room type: `classroom`, `lab`, `hall` | classroom |
| capacity | Integer | Maximum room capacity | 60 |

**Example:**
```csv
room_id,name,type,capacity
R001,Hall A,classroom,60
R002,Lab 1,lab,30
R003,Main Hall,hall,120
```

---

### faculty.csv

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| faculty_id | String | Unique faculty identifier | F001 |
| name | String | Faculty member's name | Dr. John Smith |
| email | String | Faculty email (optional) | john@university.edu |

**Example:**
```csv
faculty_id,name,email
F001,Dr. John Smith,john@university.edu
F002,Prof. Jane Doe,jane@university.edu
```

---

### time_slots.json

JSON file defining days and time slots:

```json
{
  "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  "slots": [
    { "id": 1, "label": "09:00-10:00" },
    { "id": 2, "label": "10:00-11:00" },
    { "id": 3, "label": "11:00-12:00" },
    { "id": 4, "label": "14:00-15:00" },
    { "id": 5, "label": "15:00-16:00" }
  ],
  "breakSlots": [3]
}
```

| Field | Type | Description |
|-------|------|-------------|
| days | Array | List of working days |
| slots | Array | Time slot definitions with id and label |
| breakSlots | Array | Slot IDs that are break periods |

---

### courses_*.csv

Course files (prefix with `courses_` e.g., `courses_csea1.csv`):

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| course_code | String | Course identifier | CS101 |
| name | String | Course name | Data Structures |
| faculty_id | String | Reference to faculty.csv | F001 |
| section | String | Section identifier | A |
| L | Integer | Lecture hours per week | 3 |
| T | Integer | Tutorial hours per week | 1 |
| P | Integer | Practical hours per week | 2 |
| section_strength | Integer | Number of students in section | 60 |
| is_elective | Boolean | 1 for elective, 0 for non-elective | 0 |

**Example:**
```csv
course_code,name,faculty_id,section,L,T,P,section_strength,is_elective
CS101,Data Structures,F001,A,3,1,2,60,0
CS102,Database Systems,F002,A,2,0,2,60,1
```

---

## Output Files

### Timetable.xlsx

Generated class timetable with multiple sheets:

- **Sheet per day** - Each weekday has its own sheet
- **Grid layout** - Time slots as columns, rooms as rows
- **Color coding** - Different colors for different course types (L/T/P)
- **Legend sheet** - Explains color coding and abbreviations

**What to verify:**
- Grid layout is correct
- Colors match course types
- No room conflicts (same room, same time)
- Legend sheet explains all codes

---

### ExamSchedule.xlsx

Generated exam schedule with 3 sheets:

1. **Exam Schedule** - Main exam timetable
   - Course code and name
   - Date and time slot
   - Room assignments
   - Sections covered

2. **Invigilator Schedule** - Faculty invigilator assignments
   - Faculty name and ID
   - Date and time slot
   - Room assignment

3. **Summary** - Exam statistics and overview

**What to verify:**
- No section has multiple exams on same day
- Max 4 exams per day
- All elective sections synced (same time slot)
- No Sunday exams

---

### FacultyTimetable.xlsx

Individual timetables for each faculty member:

- **One sheet per faculty** - Each faculty gets their own sheet
- **Weekly view** - All assigned sessions for the week
- **Course details** - Course code, section, type, room, time

**What to verify:**
- No faculty conflicts (same faculty, same time)
- All sessions accounted for

---

## API Endpoints

### Health Check

```
GET /api/health
```

Returns server status, file counts, and timestamp.

**Response:**
```json
{
  "status": "ok",
  "dataFiles": 5,
  "outputFiles": 3,
  "timestamp": "2025-11-01T10:00:00.000Z"
}
```

---

### List Files

```
GET /api/files
```

Returns list of uploaded data files.

---

### Upload Files

```
POST /api/upload
```

Upload rooms, faculty, time_slots, and course files.

---

### Generate Timetable

```
POST /api/generate/timetable
```

Generate class timetable and export to Excel.

---

### Generate Exam Schedule

```
POST /api/generate/exam
```

Generate exam schedule and export to Excel.

---

### Generate Faculty Timetable

```
POST /api/generate/faculty
```

Generate individual faculty timetables.

---

### Download File

```
GET /api/download/:filename
```

Download generated Excel file (.xlsx only).

---

### Delete File

```
DELETE /api/files/:filename
```

Delete an uploaded data file.

---

## Troubleshooting

### Common Issues

1. **"No files uploaded yet"** - Upload required CSV/JSON files first
2. **Generation failed** - Check that all required files are uploaded and valid
3. **Faculty timetable disabled** - Generate class timetable first
4. **Server unreachable** - Ensure `node app.js` is running on port 3000

### Error Messages

- **Invalid file type** - Only .csv and .json files are allowed
- **File not found** - File may have been deleted or not uploaded
- **Need at least X days** - Exam schedule needs more days available

---

## License

Academic Scheduling System - Timetable Generator
