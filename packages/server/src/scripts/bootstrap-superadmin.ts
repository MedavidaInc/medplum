// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

// One-off: provision the MedaVida "Tender SuperAdmin" into an ALREADY-seeded
// Medplum database.
//
// Medplum only seeds a super-admin on an EMPTY database (seed.ts::createSuperAdmin
// runs behind the isSeeded() guard). An environment whose DB already has users
// (e.g. MedaVida staging) therefore never gets the super-admin from config — and
// there is no Medplum API to bootstrap the first super-admin into an existing DB.
// This script inserts the same resources seed.ts would have, using Medplum's own
// validated write path (so search columns / references are correct).
//
// It reads the identity from the SAME config the server seeds from
// (defaultSuperAdminEmail / defaultSuperAdminPassword, i.e. the
// MEDPLUM_DEFAULT_SUPER_ADMIN_* env vars), so the seeded identity matches the
// credential the Django backend authenticates with (MEDPLUM_ADMIN_*).
//
// Idempotent: a no-op if a User with that email already exists. Creation is
// atomic (withTransaction), so "User exists" ⟺ "the whole super-admin exists".
//
// Build: bundled to packages/server/dist/scripts/bootstrap-superadmin.js via the
// esbuild entry point in build.mjs.
// Run (one-off ECS task, entryPoint overridden — the image ENTRYPOINT hardcodes
// index.js): node packages/server/dist/scripts/bootstrap-superadmin.js
// See RUNBOOK-medplum-tender-superadmin.md.

import { createReference, Operator } from '@medplum/core';
import type { Project, User } from '@medplum/fhirtypes';
import { bcryptHashPassword, createProfile, createProjectMembership } from '../auth/utils';
import { loadConfig } from '../config/loader';
import { closeDatabase, initDatabase } from '../database';
import { getShardSystemRepo } from '../fhir/repo';
import { PLACEHOLDER_SHARD_ID } from '../fhir/sharding';
import { loadStructureDefinitions } from '../fhir/structure';

export async function bootstrapSuperAdmin(configName: string): Promise<void> {
  // 'env' loads config from MEDPLUM_* env vars (same as the server's command=["env"]).
  const config = await loadConfig(configName);
  // Index the FHIR schema (structure definitions + search parameters) into memory
  // before any repo operation — the server does this in initAppServices() before
  // seedDatabase(). Without it, searchOne/createResource on 'User'/'Project' fail
  // with "Unknown resource type". Idempotent.
  loadStructureDefinitions();
  await initDatabase(config);
  try {
    const repo = getShardSystemRepo(PLACEHOLDER_SHARD_ID, undefined, { skipBackgroundJobs: true });

    const email = config.defaultSuperAdminEmail as string | undefined;
    const password = config.defaultSuperAdminPassword as string | undefined;
    if (!email || !password) {
      throw new Error(
        'defaultSuperAdminEmail / defaultSuperAdminPassword are not set. ' +
          'Set MEDPLUM_DEFAULT_SUPER_ADMIN_EMAIL and MEDPLUM_DEFAULT_SUPER_ADMIN_PASSWORD.'
      );
    }

    // Idempotency guard — User email search uses Operator.EXACT (cf. auth/newuser).
    const existing = await repo.searchOne<User>({
      resourceType: 'User',
      filters: [{ code: 'email', operator: Operator.EXACT, value: email }],
    });
    if (existing) {
      console.log(`Tender SuperAdmin: User ${email} already exists — nothing to do.`);
      return;
    }

    await repo.withTransaction(async () => {
      const superAdmin = await repo.createResource<User>({
        resourceType: 'User',
        firstName: 'Tender',
        lastName: 'SuperAdmin',
        email,
        passwordHash: await bcryptHashPassword(password),
      });
      const project = await repo.createResource<Project>({
        resourceType: 'Project',
        name: 'Super Admin',
        owner: createReference(superAdmin),
        superAdmin: true,
        strictMode: true,
      });
      const profile = await createProfile(repo, project, 'Practitioner', 'Tender', 'SuperAdmin', email);
      await createProjectMembership(repo, superAdmin, project, profile, { admin: true });
    });
    console.log(`Tender SuperAdmin provisioned for ${email}.`);
  } finally {
    await closeDatabase();
  }
}

if (import.meta.main) {
  bootstrapSuperAdmin(process.argv.length === 3 ? process.argv[2] : 'env').catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
