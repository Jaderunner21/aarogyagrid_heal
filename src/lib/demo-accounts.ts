import type { Enums } from "@/lib/database.types"

// Demo accounts. Shared by scripts/create-demo-users.ts and the DemoLogin panel.
// scope: state code, district code, or facility code (db/base/02_seed.sql, db/seed/002_upgrade_seed.sql);
// "IN" for the national admin.
export type DemoAccount = {
  email: string
  fullName: string
  role: Enums<"user_role">
  scope: string
  label: string
  district?: string
  state: "Rajasthan" | "Gujarat" | "India"
  /** PHC logins only: the medical officer or the staff login */
  phcPosition?: "staff" | "medical_officer"
}

// staff = the PHC login for daily entry; doctor = the medical officer (matches the staff roster)
const phcs: { code: string; place: string; district: string; staff: string; doctor: string }[] = [
  { code: "PHC-UDR-01", place: "Gogunda", district: "Udaipur", staff: "Kavita Meena" , doctor: "Dr. Sunita Jain" },
  { code: "PHC-UDR-02", place: "Jhadol", district: "Udaipur", staff: "Ramesh Garasia" , doctor: "Dr. Rajendra Bhil" },
  { code: "PHC-UDR-03", place: "Kotra", district: "Udaipur", staff: "Sunita Kharadi" , doctor: "Dr. Hemant Jain" },
  { code: "PHC-UDR-04", place: "Kherwara", district: "Udaipur", staff: "Anil Parmar" , doctor: "Dr. Kiran Rawat" },
  { code: "PHC-UDR-05", place: "Rishabhdev", district: "Udaipur", staff: "Pooja Jain" , doctor: "Dr. Bharat Patel" },
  { code: "PHC-UDR-06", place: "Mavli", district: "Udaipur", staff: "Mahesh Dangi" , doctor: "Dr. Bharat Garasia" },
  { code: "PHC-UDR-07", place: "Vallabhnagar", district: "Udaipur", staff: "Rekha Suthar" , doctor: "Dr. Pooja Meena" },
  { code: "PHC-UDR-08", place: "Badgaon", district: "Udaipur", staff: "Deepak Paliwal" , doctor: "Dr. Rekha Choudhary" },
  { code: "PHC-RSD-01", place: "Nathdwara", district: "Rajsamand", staff: "Neha Sanadhya" , doctor: "Dr. Dinesh Bhil" },
  { code: "PHC-RSD-02", place: "Kelwara", district: "Rajsamand", staff: "Bhanwar Lal Gameti" , doctor: "Dr. Hemant Kumawat" },
  { code: "PHC-RSD-03", place: "Amet", district: "Rajsamand", staff: "Seema Kumawat" , doctor: "Dr. Priya Dangi" },
  { code: "PHC-RSD-04", place: "Deogarh", district: "Rajsamand", staff: "Hemant Rawat" , doctor: "Dr. Sarita Joshi" },
  { code: "PHC-RSD-05", place: "Railmagra", district: "Rajsamand", staff: "Manju Gurjar" , doctor: "Dr. Sunita Joshi" },
  { code: "PHC-RSD-06", place: "Khamnor", district: "Rajsamand", staff: "Prakash Bhil" , doctor: "Dr. Lokesh Patel" },
  { code: "PHC-RSD-07", place: "Bhim", district: "Rajsamand", staff: "Laxmi Devi Rathore" , doctor: "Dr. Anita Kumawat" },
  { code: "PHC-RSD-08", place: "Charbhuja", district: "Rajsamand", staff: "Gopal Purohit" , doctor: "Dr. Mukesh Meena" },
  { code: "PHC-DGP-01", place: "Sagwara", district: "Dungarpur", staff: "Anita Patidar" , doctor: "Dr. Anita Choudhary" },
  { code: "PHC-DGP-02", place: "Aspur", district: "Dungarpur", staff: "Dinesh Roat" , doctor: "Dr. Anita Jain" },
  { code: "PHC-DGP-03", place: "Simalwara", district: "Dungarpur", staff: "Kamla Damor" , doctor: "Dr. Lokesh Meena" },
  { code: "PHC-DGP-04", place: "Bichhiwara", district: "Dungarpur", staff: "Vikram Ahari" , doctor: "Dr. Rekha Dangi" },
  { code: "PHC-DGP-05", place: "Galiyakot", district: "Dungarpur", staff: "Shabana Bohra" , doctor: "Dr. Ramesh Jain" },
  { code: "PHC-DGP-06", place: "Sabla", district: "Dungarpur", staff: "Rajendra Kalal" , doctor: "Dr. Kavita Patel" },
  { code: "PHC-DGP-07", place: "Chikhli", district: "Dungarpur", staff: "Geeta Bhagora" , doctor: "Dr. Mahesh Patel" },
  { code: "PHC-DGP-08", place: "Dovda", district: "Dungarpur", staff: "Mukesh Pargi" , doctor: "Dr. Lokesh Rawat" },
]

const gujaratPhcs: typeof phcs = [
  { code: "PHC-ARV-01", place: "Bhiloda", district: "Aravalli", staff: "Hetal Patel" , doctor: "Dr. Payal Damor" },
  { code: "PHC-ARV-02", place: "Meghraj", district: "Aravalli", staff: "Jignesh Parmar" , doctor: "Dr. Jyoti Chauhan" },
  { code: "PHC-ARV-03", place: "Malpur", district: "Aravalli", staff: "Nirali Solanki" , doctor: "Dr. Jignesh Shah" },
  { code: "PHC-ARV-04", place: "Dhansura", district: "Aravalli", staff: "Bhavesh Chauhan" , doctor: "Dr. Nirali Bhagora" },
  { code: "PHC-ARV-05", place: "Bayad", district: "Aravalli", staff: "Dhara Desai" , doctor: "Dr. Paresh Joshi" },
  { code: "PHC-ARV-06", place: "Shamlaji", district: "Aravalli", staff: "Kalpesh Vasava" , doctor: "Dr. Hetal Makwana" },
  { code: "PHC-SKT-01", place: "Idar", district: "Sabarkantha", staff: "Komal Shah" , doctor: "Dr. Nilesh Vasava" },
  { code: "PHC-SKT-02", place: "Khedbrahma", district: "Sabarkantha", staff: "Chirag Damor" , doctor: "Dr. Minal Vasava" },
  { code: "PHC-SKT-03", place: "Prantij", district: "Sabarkantha", staff: "Payal Makwana" , doctor: "Dr. Ketan Bhagora" },
  { code: "PHC-SKT-04", place: "Talod", district: "Sabarkantha", staff: "Hardik Rathod" , doctor: "Dr. Mehul Desai" },
  { code: "PHC-SKT-05", place: "Vijaynagar", district: "Sabarkantha", staff: "Falguni Bhagora" , doctor: "Dr. Rakesh Desai" },
  { code: "PHC-SKT-06", place: "Poshina", district: "Sabarkantha", staff: "Nilesh Joshi" , doctor: "Dr. Rakesh Bhagora" },
]

const phcAccount =
  (state: DemoAccount["state"]) =>
  (p: (typeof phcs)[number]): DemoAccount[] => [
    {
      email: `phc.${p.code.toLowerCase()}@heal.demo`,
      fullName: p.staff,
      role: "phc_staff",
      scope: p.code,
      label: `PHC ${p.place}`,
      district: p.district,
      state,
      phcPosition: "staff",
    },
    {
      email: `mo.${p.code.toLowerCase()}@heal.demo`,
      fullName: p.doctor,
      role: "phc_staff",
      scope: p.code,
      label: `PHC ${p.place}`,
      district: p.district,
      state,
      phcPosition: "medical_officer",
    },
  ]

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: "state.admin@heal.demo",
    fullName: "Dr. Arvind Sharma",
    role: "state_admin",
    scope: "RJ",
    label: "State admin · Rajasthan",
    state: "Rajasthan",
  },
  {
    email: "do.udaipur@heal.demo",
    fullName: "Dr. Priya Chouhan",
    role: "district_officer",
    scope: "RJ-UDR",
    label: "District officer · Udaipur",
    district: "Udaipur",
    state: "Rajasthan",
  },
  {
    email: "do.rajsamand@heal.demo",
    fullName: "Dr. Sanjay Mathur",
    role: "district_officer",
    scope: "RJ-RSD",
    label: "District officer · Rajsamand",
    district: "Rajsamand",
    state: "Rajasthan",
  },
  {
    email: "do.dungarpur@heal.demo",
    fullName: "Dr. Farida Khan",
    role: "district_officer",
    scope: "RJ-DGP",
    label: "District officer · Dungarpur",
    district: "Dungarpur",
    state: "Rajasthan",
  },
  {
    email: "wh.udaipur@heal.demo",
    fullName: "Suresh Menaria",
    role: "warehouse_manager",
    scope: "WH-UDR",
    label: "Warehouse · Udaipur",
    district: "Udaipur",
    state: "Rajasthan",
  },
  {
    email: "wh.rajsamand@heal.demo",
    fullName: "Kailash Joshi",
    role: "warehouse_manager",
    scope: "WH-RSD",
    label: "Warehouse · Rajsamand",
    district: "Rajsamand",
    state: "Rajasthan",
  },
  {
    email: "wh.dungarpur@heal.demo",
    fullName: "Nirmala Trivedi",
    role: "warehouse_manager",
    scope: "WH-DGP",
    label: "Warehouse · Dungarpur",
    district: "Dungarpur",
    state: "Rajasthan",
  },
  ...phcs.flatMap(phcAccount("Rajasthan")),
  // ---- national + Gujarat (upgrade 002)
  {
    email: "national.admin@heal.demo",
    fullName: "Dr. Meera Iyer",
    role: "national_admin",
    scope: "IN",
    label: "National admin · India",
    state: "India",
  },
  {
    email: "state.gujarat@heal.demo",
    fullName: "Dr. Kiran Desai",
    role: "state_admin",
    scope: "GJ",
    label: "State admin · Gujarat",
    state: "Gujarat",
  },
  {
    email: "do.aravalli@heal.demo",
    fullName: "Dr. Nayan Trivedi",
    role: "district_officer",
    scope: "GJ-ARV",
    label: "District officer · Aravalli",
    district: "Aravalli",
    state: "Gujarat",
  },
  {
    email: "do.sabarkantha@heal.demo",
    fullName: "Dr. Rupal Mehta",
    role: "district_officer",
    scope: "GJ-SKT",
    label: "District officer · Sabarkantha",
    district: "Sabarkantha",
    state: "Gujarat",
  },
  {
    email: "wh.aravalli@heal.demo",
    fullName: "Mahendra Barot",
    role: "warehouse_manager",
    scope: "WH-ARV",
    label: "Warehouse · Aravalli",
    district: "Aravalli",
    state: "Gujarat",
  },
  {
    email: "wh.sabarkantha@heal.demo",
    fullName: "Sejal Pandya",
    role: "warehouse_manager",
    scope: "WH-SKT",
    label: "Warehouse · Sabarkantha",
    district: "Sabarkantha",
    state: "Gujarat",
  },
  ...gujaratPhcs.flatMap(phcAccount("Gujarat")),
]

export function isDemoEmail(email: string): boolean {
  return DEMO_ACCOUNTS.some((a) => a.email === email)
}
