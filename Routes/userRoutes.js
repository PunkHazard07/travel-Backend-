import express from "express"
import { 
    register,
    login,
    getUserProfile,
    // updateUserProfile,
    deleteUserAccount
} from '../Controller/userController.js';
import { authenticate } from '../utils/authMiddleware.js';

const router = express.Router();

// User Registration
router.post('/register', register);
// User Login
router.post('/login', login);
// Get User Profile
router.get('/profile', authenticate, getUserProfile);
// // Update User Profile
// router.put('/profile', authenticate, updateUserProfile);
// Delete User Account
router.delete('/delete', authenticate, deleteUserAccount);

export default router;