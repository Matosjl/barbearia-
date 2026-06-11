import { Router } from 'express';
import { router as authRouter } from './modules/auth.js';
import { router as adminRouter } from './modules/admin.js';
import { router as shopRouter } from './modules/shop.js';
import { router as servicesRouter } from './modules/services.js';
import { router as barbersRouter } from './modules/barbers.js';
import { router as customersRouter } from './modules/customers.js';
import { router as appointmentsRouter } from './modules/appointments.js';
import { router as financialRouter } from './modules/financial.js';
import { router as dashboardRouter } from './modules/dashboard.js';

export const router = Router();

router.get('/', (_req, res) => res.json({ name: 'barber-api', version: 'v1' }));

router.use('/admin', adminRouter);  // rotas privadas — requer ADMIN_API_KEY
router.use(authRouter);            // /auth/*
router.use(shopRouter);            // /shop, /shop/settings
router.use('/services', servicesRouter);
router.use('/barbers', barbersRouter);
router.use('/customers', customersRouter);
router.use('/appointments', appointmentsRouter);
router.use('/financial', financialRouter);
router.use('/dashboard', dashboardRouter);
