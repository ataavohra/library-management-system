import { Request, Response, NextFunction } from 'express';
import { User } from '../db/models';
import { httpStatusConstant, httpErrorMessageConstant, messageConstant } from '../constant';
import { authUtils, loggerUtils } from '../utils';

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Validate authorization header and extract token
        const { token } = await authUtils.validateAuthorizationHeader(req.headers);

        // Verify the JWT token
        const verifiedToken = await authUtils.verifyJwtToken(token);

        // Check if user exists with the email from the token
        const user = await User.findOne({
            email: verifiedToken.email,
            isActive: true,
        });
        if (!user) {
            return res.status(httpStatusConstant.NOT_FOUND).json({
                status: false,
                message: messageConstant.USER_NOT_FOUND,
            });
        }

        next();
    } catch (error) {
        loggerUtils.logger.error(error);
        return res.status(httpStatusConstant.INTERNAL_SERVER_ERROR).json({
            message: httpErrorMessageConstant.INTERNAL_SERVER_ERROR,
        });
    }
};

const isAuthTokenMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Validate authorization header and extract token
        const { token } = await authUtils.validateAuthorizationHeader(req.headers);

        // Verify the JWT token
        const verifiedToken = await authUtils.verifyJwtToken(token);

        const user = await User.findOne({
            email: verifiedToken.email,
            isActive: true,
        });
        if (!user?.isAuthToken) {
            return res.status(httpStatusConstant.INVALID_TOKEN).json({
                status: false,
                message: httpErrorMessageConstant.INVALID_TOKEN,
            });
        }
        next();
    } catch (error) {
        loggerUtils.logger.error(error);
        return res.status(httpStatusConstant.INTERNAL_SERVER_ERROR).json({
            message: httpErrorMessageConstant.INTERNAL_SERVER_ERROR,
        });
    }
};

export default {
    authMiddleware,
    isAuthTokenMiddleware,
};
