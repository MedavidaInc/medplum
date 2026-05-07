import { AppShell, Loading, Logo, useMedplum, useMedplumProfile } from '@medplum/react';
import {
  IconBuildingHospital,
  IconChartBar,
  IconClipboardList,
  IconHome,
  IconMessage,
  IconPill,
  IconReceipt2,
  IconStethoscope,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import { Suspense } from 'react';
import type { JSX } from 'react';
import { Navigate, Route, Routes } from 'react-router';

// Admin / MSO
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { ClinicsPage } from './pages/admin/ClinicsPage';
import { ClinicDetailPage } from './pages/admin/ClinicDetailPage';

// Clinic EMR
import { PatientListPage } from './pages/clinic/PatientListPage';
import { PatientPage } from './pages/clinic/PatientPage';
import { EncounterPage } from './pages/clinic/EncounterPage';
import { TasksPage } from './pages/clinic/TasksPage';
import { MessagesPage } from './pages/clinic/MessagesPage';
import { PharmacyOrdersPage } from './pages/clinic/PharmacyOrdersPage';
import { NonRxPage } from './pages/clinic/NonRxPage';

// Patient portal
import { PatientPortalPage } from './pages/patient/PatientPortalPage';
import { MembershipPage } from './pages/patient/MembershipPage';

// Shared
import { SignInPage } from './pages/SignInPage';
import { ResourcePage } from './pages/ResourcePage';

export function App(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();

  if (medplum.isLoading()) {
    return <Loading />;
  }

  return (
    <AppShell logo={<Logo size={24} />} menus={menus}>
      <Suspense fallback={<Loading />}>
        <Routes>
          {profile ? (
            <>
              <Route path="/signin" element={<SignInPage />} />

              {/* MSO Admin */}
              <Route path="/" element={<AdminDashboardPage />} />
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/admin/clinics" element={<ClinicsPage />} />
              <Route path="/admin/clinics/:id" element={<ClinicDetailPage />} />

              {/* Clinic EMR */}
              <Route path="/clinic/patients" element={<PatientListPage />} />
              <Route path="/clinic/patients/:patientId" element={<PatientPage />} />
              <Route path="/clinic/patients/:patientId/encounter/:encounterId" element={<EncounterPage />} />
              <Route path="/clinic/tasks" element={<TasksPage />} />
              <Route path="/clinic/messages" element={<MessagesPage />} />
              <Route path="/clinic/pharmacy" element={<PharmacyOrdersPage />} />
              <Route path="/clinic/patients/:patientId/non-rx" element={<NonRxPage />} />

              {/* Patient portal */}
              <Route path="/portal" element={<PatientPortalPage />} />
              <Route path="/portal/membership" element={<MembershipPage />} />

              {/* Generic FHIR resource viewer */}
              <Route path="/:resourceType/:id" element={<ResourcePage />} />
            </>
          ) : (
            <>
              <Route path="/signin" element={<SignInPage />} />
              <Route path="*" element={<Navigate to="/signin" replace />} />
            </>
          )}
        </Routes>
      </Suspense>
    </AppShell>
  );
}

const menus = [
  {
    title: 'MSO Admin',
    links: [
      { icon: <IconHome />, label: 'Dashboard', href: '/admin' },
      { icon: <IconBuildingHospital />, label: 'Clinics', href: '/admin/clinics' },
      { icon: <IconChartBar />, label: 'Analytics', href: '/admin' },
    ],
  },
  {
    title: 'Clinic EMR',
    links: [
      { icon: <IconUsers />, label: 'Patients', href: '/clinic/patients' },
      { icon: <IconClipboardList />, label: 'Tasks', href: '/clinic/tasks' },
      { icon: <IconMessage />, label: 'Messages', href: '/clinic/messages' },
      { icon: <IconPill />, label: 'Pharmacy Orders', href: '/clinic/pharmacy' },
      { icon: <IconStethoscope />, label: 'Non-Rx', href: '/clinic/patients' },
    ],
  },
  {
    title: 'Patient Portal',
    links: [
      { icon: <IconUser />, label: 'My Health', href: '/portal' },
      { icon: <IconReceipt2 />, label: 'Membership & Billing', href: '/portal/membership' },
    ],
  },
];
