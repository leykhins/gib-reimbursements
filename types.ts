export interface User {
  id: string;
  email: string;
  full_name: string;
  department: string;
  role: 'employee' | 'admin' | 'manager' | 'accounting';
  mileage_rate?: number;
  created_at: string;
  updated_at: string;
}

export interface ReimbursementRequest {
  id: string;
  employee_id: string;
  job_number: string;
  description: string;
  amount: number;
  is_travel: boolean;
  travel_distance?: number;
  travel_type?: 'car' | 'public_transport' | null;
  receipt_url: string;
  status: 'pending' | 'admin_verified' | 'manager_approved' | 'completed' | 'rejected';
  admin_verified_by?: string | null;
  admin_verified_at?: string | null;
  manager_approved_by?: string | null;
  manager_approved_at?: string | null;
  accounting_processed_by?: string | null;
  accounting_processed_at?: string | null;
  pdf_downloaded_at?: string | null;
  payment_method?: 'bank_draft' | 'e-transfer' | null;
  payment_reference?: string | null;
  created_at: string;
  updated_at: string;
  profiles?: {
    first_name: string;
    last_name: string;
    email: string;
    department: string;
  };
  manager_approver?: {
    first_name: string;
    last_name: string;
  } | null;
  admin_verifier?: {
    first_name: string;
    last_name: string;
  } | null;
}

export interface ErrorObject {
  message: string;
  [key: string]: any;
}
