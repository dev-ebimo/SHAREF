const User = require("../models/User");
const Resource = require("../models/Resource");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const Bookmark = require("../models/Bookmark");
const DownloadLog = require("../models/DownloadLog");
const Announcement = require("../models/Announcement");

async function seedDatabase() {
  try {
    const adminExists = await User.findOne({ email: "admin@sharef.edu" });
    if (!adminExists) {
      console.log("Creating default Admin demo account: admin@sharef.edu");
      await User.create({
        fullName: "Campus Administrator",
        email: "admin@sharef.edu",
        password: "AdminPass123!",
        matricNumber: "ADM/2026/001",
        university: "University of Lagos",
        faculty: "Administration",
        department: "Academic Affairs",
        level: "500",
        gender: "Other",
        role: "admin",
        isVerified: true,
        walletBalance: 10000,
        accountStatus: "active",
        preferences: {
          landingPage: "dashboard",
          moderation: { landingPage: "pending", autoAdvance: true, itemsPerPage: 25 },
          notifications: {
            newUploads: { inApp: true, email: true },
            uploadStatus: { inApp: true, email: true },
            announcements: { inApp: true, email: true },
          },
        },
      });
    }

    const studentExists = await User.findOne({ email: "student@sharef.edu" });
    if (!studentExists) {
      console.log("Creating default Student demo account: student@sharef.edu");
      await User.create({
        fullName: "Ebimotimi Shadrack",
        email: "student@sharef.edu",
        password: "StudentPass123!",
        matricNumber: "U2021/CSC/042",
        university: "University of Lagos",
        faculty: "Science",
        department: "Computer Science",
        level: "300",
        gender: "Male",
        role: "student",
        isVerified: true,
        walletBalance: 3500,
        accountStatus: "active",
        lastLoginAt: new Date(),
        preferences: {
          landingPage: "dashboard",
          notifications: {
            newUploads: { inApp: true, email: true },
            uploadStatus: { inApp: true, email: true },
            announcements: { inApp: true, email: true },
          },
        },
      });
    }

    const pqCount = await Resource.countDocuments({ type: "Past Question", status: "approved" });
    if (pqCount === 0) {
      console.log("Seeding verified Past Questions into database...");
      const studentUser = (await User.findOne({ email: "student@sharef.edu" })) || (await User.findOne({ role: "student" }));
      const adminUser = (await User.findOne({ email: "admin@sharef.edu" })) || (await User.findOne({ role: "admin" }));

      if (studentUser && adminUser) {
        await Resource.create([
          {
            title: "CSC 206 - Computer Architecture Past Exam Questions (2023/2024)",
            type: "Past Question",
            department: "Computer Science",
            course: "CSC 206",
            level: "200",
            semester: "Second",
            session: "2023/2024",
            uploader: studentUser._id,
            fileName: "csc206_past_questions.pdf",
            fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
            cloudinaryPublicId: "sample_csc206_pq",
            cloudinaryResourceType: "raw",
            fileSizeBytes: 1450000,
            fileExtension: "pdf",
            pages: 8,
            status: "approved",
            reviewedBy: adminUser._id,
            reviewedAt: new Date(),
            downloads: 14,
            previewType: "text",
            previewSnippet: "UNIVERSITY OF LAGOS\nDEPARTMENT OF COMPUTER SCIENCE\nSECOND SEMESTER EXAMINATIONS 2023/2024\nCOURSE: CSC 206 - COMPUTER ARCHITECTURE\n\nQuestion 1: Explain the Von Neumann bottleneck and how cache memory hierarchies mitigate latency. Detail the 5 stages of the RISC instruction execution pipeline...",
            description: "Official past question paper with detailed working steps for pipeline hazard and memory hierarchy problems.",
          },
          {
            title: "CSC 210 - Data Structures Past Questions & Solutions",
            type: "Past Question",
            department: "Computer Science",
            course: "CSC 210",
            level: "200",
            semester: "Second",
            session: "2024/2025",
            uploader: studentUser._id,
            fileName: "csc210_past_questions.pdf",
            fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
            cloudinaryPublicId: "sample_csc210_pq",
            cloudinaryResourceType: "raw",
            fileSizeBytes: 1850000,
            fileExtension: "pdf",
            pages: 12,
            status: "approved",
            reviewedBy: adminUser._id,
            reviewedAt: new Date(),
            downloads: 22,
            previewType: "text",
            previewSnippet: "CSC 210 EXAMINATIONS: Comprehensive questions covering Binary Search Trees, AVL balance rotations, Heap Sort, and Dijkstra's Shortest Path algorithm with step-by-step graph walkthroughs...",
            description: "Compiled past examination questions with verified answers from top tutors.",
          },
          {
            title: "INF 202 - Human Computer Interaction Past Questions (2024)",
            type: "Past Question",
            department: "Computer Science",
            course: "INF 202",
            level: "200",
            semester: "Second",
            session: "2023/2024",
            uploader: studentUser._id,
            fileName: "inf202_past_questions.pdf",
            fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
            cloudinaryPublicId: "sample_inf202_pq",
            cloudinaryResourceType: "raw",
            fileSizeBytes: 980000,
            fileExtension: "pdf",
            pages: 6,
            status: "approved",
            reviewedBy: adminUser._id,
            reviewedAt: new Date(),
            downloads: 9,
            previewType: "text",
            previewSnippet: "DEPARTMENT OF SYSTEMS & INFORMATICS\nINF 202: HUMAN COMPUTER INTERACTION\n\nQuestion 1: Compare Nielsen's 10 Usability Heuristics with Shneiderman's Eight Golden Rules. Provide concrete UI examples for Error Prevention...",
            description: "Recent semester past questions with heuristic evaluation checklist.",
          },
        ]);
      }
    }

    const userCount = await User.countDocuments();
    if (userCount > 3) {
      return;
    }

    console.log("Seeding Sharef database with initial demo data...");

    // 1. Create Admin
    const admin = await User.create({
      fullName: "Campus Administrator",
      email: "admin@sharef.edu",
      password: "AdminPass123!",
      matricNumber: "ADM/2026/001",
      university: "University of Lagos",
      faculty: "Administration",
      department: "Academic Affairs",
      level: "500",
      gender: "Other",
      role: "admin",
      isVerified: true,
      walletBalance: 10000,
      accountStatus: "active",
      preferences: {
        landingPage: "dashboard",
        moderation: { landingPage: "pending", autoAdvance: true, itemsPerPage: 25 },
        notifications: {
          newUploads: { inApp: true, email: true },
          uploadStatus: { inApp: true, email: true },
          announcements: { inApp: true, email: true },
        },
      },
    });

    // 2. Create Students
    const student1 = await User.create({
      fullName: "Ebimotimi Shadrack",
      email: "student@sharef.edu",
      password: "StudentPass123!",
      matricNumber: "U2021/CSC/042",
      university: "University of Lagos",
      faculty: "Science",
      department: "Computer Science",
      level: "300",
      gender: "Male",
      role: "student",
      isVerified: true,
      walletBalance: 3500,
      accountStatus: "active",
      lastLoginAt: new Date(),
      preferences: {
        landingPage: "dashboard",
        notifications: {
          newUploads: { inApp: true, email: true },
          uploadStatus: { inApp: true, email: true },
          announcements: { inApp: true, email: true },
        },
      },
    });

    const student2 = await User.create({
      fullName: "Amina Bello",
      email: "amina@sharef.edu",
      password: "StudentPass123!",
      matricNumber: "U2022/ENG/108",
      university: "University of Lagos",
      faculty: "Engineering",
      department: "Engineering",
      level: "200",
      gender: "Female",
      role: "student",
      isVerified: true,
      walletBalance: 2000,
      accountStatus: "active",
      lastLoginAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      preferences: {
        landingPage: "dashboard",
        notifications: {
          newUploads: { inApp: true, email: true },
          uploadStatus: { inApp: true, email: true },
          announcements: { inApp: true, email: true },
        },
      },
    });

    const student3 = await User.create({
      fullName: "Chinedu Okafor",
      email: "chinedu@sharef.edu",
      password: "StudentPass123!",
      matricNumber: "U2023/MTH/019",
      university: "University of Lagos",
      faculty: "Science",
      department: "Mathematics",
      level: "100",
      gender: "Male",
      role: "student",
      isVerified: true,
      walletBalance: 1200,
      accountStatus: "active",
      lastLoginAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      preferences: { landingPage: "dashboard" },
    });

    // 3. Create Sample Resources
    const resourcesData = [
      {
        title: "CSC 301 - Operating Systems Architecture & Kernel Design Complete Notes",
        type: "Lecture Note",
        department: "Computer Science",
        course: "CSC 301",
        level: "300",
        semester: "First",
        session: "2024/2025",
        uploader: student1._id,
        fileName: "csc301_operating_systems_notes.pdf",
        fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
        cloudinaryPublicId: "sample_csc301_pdf",
        cloudinaryResourceType: "raw",
        fileSizeBytes: 2450000,
        fileExtension: "pdf",
        pages: 32,
        status: "approved",
        reviewedBy: admin._id,
        reviewedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        downloads: 48,
        previewType: "text",
        previewSnippet: "Chapter 1: Introduction to Operating Systems.\nAn operating system is system software that manages computer hardware, software resources, and provides common services for computer programs. Key topics include Process Scheduling, Memory Management, Virtual Memory, File Systems, and Concurrency Control...",
        description: "Comprehensive handwritten and typed lecture notes for CSC 301 with diagrams and past exam insights.",
        createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      },
      {
        title: "CSC 305 - Database Management Systems: SQL, Indexing & ACID Transactions",
        type: "Lecture Note",
        department: "Computer Science",
        course: "CSC 305",
        level: "300",
        semester: "First",
        session: "2024/2025",
        uploader: student1._id,
        fileName: "csc305_database_systems.docx",
        fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
        cloudinaryPublicId: "sample_csc305_docx",
        cloudinaryResourceType: "raw",
        fileSizeBytes: 1850000,
        fileExtension: "docx",
        pages: 45,
        status: "approved",
        reviewedBy: admin._id,
        reviewedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        downloads: 35,
        previewType: "text",
        previewSnippet: "CSC 305 Database Systems: Module 1 focuses on Relational Algebra, Entity Relationship (ER) Modeling, Normalization (1NF, 2NF, 3NF, BCNF), and B-Tree indexing mechanisms...",
        description: "Covers SQL query optimization, ER diagrams, Normalization theory, and transaction isolation levels.",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
      {
        title: "CSC 301 - Operating Systems 2023/2024 First Semester Examination Past Questions",
        type: "Past Question",
        department: "Computer Science",
        course: "CSC 301",
        level: "300",
        semester: "First",
        session: "2023/2024",
        uploader: student2._id,
        fileName: "csc301_pq_2024.pdf",
        fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
        cloudinaryPublicId: "sample_csc301_pq",
        cloudinaryResourceType: "raw",
        fileSizeBytes: 1200000,
        fileExtension: "pdf",
        pages: 6,
        status: "approved",
        reviewedBy: admin._id,
        reviewedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        downloads: 62,
        previewType: "text",
        previewSnippet: "UNIVERSITY OF LAGOS\nDEPARTMENT OF COMPUTER SCIENCE\nFIRST SEMESTER EXAMINATIONS 2023/2024\nCOURSE: CSC 301 - OPERATING SYSTEMS\n\nQuestion 1: Explain the difference between preemptive and non-preemptive scheduling algorithms. Given the following burst times...",
        description: "Official past question paper with detailed working steps for the Banker's algorithm and scheduling problems.",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        title: "ENG 201 - Engineering Mechanics and Statics Past Exam Papers (2022-2024)",
        type: "Past Question",
        department: "Engineering",
        course: "ENG 201",
        level: "200",
        semester: "Second",
        session: "2023/2024",
        uploader: student2._id,
        fileName: "eng201_mechanics_pq.pdf",
        fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
        cloudinaryPublicId: "sample_eng201_pq",
        cloudinaryResourceType: "raw",
        fileSizeBytes: 3100000,
        fileExtension: "pdf",
        pages: 14,
        status: "approved",
        reviewedBy: admin._id,
        reviewedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        downloads: 29,
        previewType: "text",
        previewSnippet: "FACULTY OF ENGINEERING\nDEPARTMENT OF MECHANICAL/CIVIL ENGINEERING\nENG 201 - ENGINEERING MECHANICS\n\nSection A: Free body diagrams, truss analysis using method of joints and method of sections...",
        description: "Compiled 3-year past questions with answers for truss systems and shear force diagrams.",
        createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      },
      {
        title: "MTH 201 - Advanced Engineering Mathematics & Differential Equations",
        type: "Lecture Note",
        department: "Mathematics",
        course: "MTH 201",
        level: "200",
        semester: "First",
        session: "2024/2025",
        uploader: student3._id,
        fileName: "mth201_differential_equations.pdf",
        fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
        cloudinaryPublicId: "sample_mth201_pdf",
        cloudinaryResourceType: "raw",
        fileSizeBytes: 2800000,
        fileExtension: "pdf",
        pages: 26,
        status: "approved",
        reviewedBy: admin._id,
        reviewedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        downloads: 19,
        previewType: "text",
        previewSnippet: "MTH 201: Ordinary Differential Equations of First and Second Order. Homogeneous and non-homogeneous linear differential equations with constant coefficients. Laplace Transforms and Fourier Series...",
        description: "Concise summary sheet of differential equation formulas, Laplace tables, and worked examples.",
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
      {
        title: "CSC 401 - Artificial Intelligence & Expert Systems (Pending Approval)",
        type: "Lecture Note",
        department: "Computer Science",
        course: "CSC 401",
        level: "400",
        semester: "First",
        session: "2024/2025",
        uploader: student1._id,
        fileName: "csc401_ai_systems.pdf",
        fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
        cloudinaryPublicId: "sample_csc401_pending",
        cloudinaryResourceType: "raw",
        fileSizeBytes: 1900000,
        fileExtension: "pdf",
        pages: 18,
        status: "pending",
        downloads: 0,
        previewType: "text",
        previewSnippet: "CSC 401: Overview of State-space Search, A* Heuristic Search, Minimax with Alpha-Beta pruning, Knowledge Representation, and Rule-based Expert Systems...",
        description: "Newly uploaded lecture material pending verification by course rep and admin.",
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      },
      {
        title: "ENG 302 - Fluid Dynamics and Thermodynamics Past Exam 2024 (Pending Review)",
        type: "Past Question",
        department: "Engineering",
        course: "ENG 302",
        level: "300",
        semester: "First",
        session: "2023/2024",
        uploader: student2._id,
        fileName: "eng302_fluids_pq.pdf",
        fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
        cloudinaryPublicId: "sample_eng302_pending",
        cloudinaryResourceType: "raw",
        fileSizeBytes: 1100000,
        fileExtension: "pdf",
        pages: 8,
        status: "pending",
        downloads: 0,
        previewType: "text",
        previewSnippet: "ENG 302 FLUID MECHANICS & THERMODYNAMICS\nExam Questions: Question 1: Derive the Bernoulli equation from first principles for steady incompressible flow...",
        description: "Official 2024 First semester past question paper submitted for queue approval.",
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      },
      {
        title: "CSC 101 - Introduction to Programming (Duplicate Submission)",
        type: "Lecture Note",
        department: "Computer Science",
        course: "CSC 101",
        level: "100",
        semester: "First",
        session: "2024/2025",
        uploader: student3._id,
        fileName: "csc101_duplicate.pdf",
        fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
        cloudinaryPublicId: "sample_csc101_rejected",
        cloudinaryResourceType: "raw",
        fileSizeBytes: 800000,
        fileExtension: "pdf",
        pages: 4,
        status: "rejected",
        rejectionReason: "duplicate",
        reviewedBy: admin._id,
        reviewedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        downloads: 0,
        previewType: "text",
        previewSnippet: "Introduction to Python programming basic syntax...",
        description: "Identical to previously uploaded CSC 101 guide.",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ];

    const createdResources = await Resource.insertMany(resourcesData);

    // 4. Create Bookmarks for student1
    await Bookmark.create([
      { user: student1._id, resource: createdResources[0]._id },
      { user: student1._id, resource: createdResources[2]._id },
    ]);

    // 5. Create Download Logs (powers Trending & Continue Learning)
    await DownloadLog.create([
      { user: student1._id, resource: createdResources[0]._id, createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000) },
      { user: student1._id, resource: createdResources[1]._id, createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000) },
      { user: student2._id, resource: createdResources[0]._id, createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000) },
      { user: student2._id, resource: createdResources[2]._id, createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    ]);

    // 6. Create Transactions (for student1 wallet history)
    await Transaction.create([
      {
        user: student1._id,
        type: "deposit",
        amount: 4000,
        status: "successful",
        reference: `SHAREF-${student1._id}-seed-dep-1`,
        description: "Wallet funding via Paystack",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
      {
        user: student1._id,
        type: "purchase",
        amount: 500,
        status: "successful",
        resource: createdResources[0]._id,
        description: `${createdResources[0].course} — ${createdResources[0].title}`,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ]);

    // 7. Create Announcement
    const announcement = await Announcement.create({
      title: "Welcome to Semester Exam Prep on Sharef!",
      message: "The 2024/2025 examination schedule is approaching. Verify your materials and download verified lecture summaries from course reps.",
      targetDepartments: [],
      targetLevels: [],
      createdBy: admin._id,
      recipientCount: 3,
    });

    // 8. Create Notifications
    await Notification.create([
      {
        type: "new_upload",
        resource: createdResources[5]._id,
        recipient: null, // Admin notification
        unread: true,
      },
      {
        type: "new_upload",
        resource: createdResources[6]._id,
        recipient: null, // Admin notification
        unread: true,
      },
      {
        type: "resource_approved",
        resource: createdResources[0]._id,
        recipient: student1._id,
        unread: false,
      },
      {
        type: "announcement",
        announcement: announcement._id,
        recipient: student1._id,
        unread: true,
      },
    ]);

    console.log("Database seeded successfully with Demo Accounts:");
    console.log("  -> Admin:   admin@sharef.edu    | Password: AdminPass123!");
    console.log("  -> Student: student@sharef.edu  | Password: StudentPass123!");
    console.log("  -> Student: amina@sharef.edu    | Password: StudentPass123!");
  } catch (err) {
    console.error("Database seeding error:", err.message);
  }
}

module.exports = seedDatabase;
