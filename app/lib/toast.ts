import { toast } from 'sonner';
import { ApiError } from './api';

export const notify = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  info: (message: string) => toast.info(message),
  hint: (message: string) => toast(message),
  apiError: (error: unknown, fallback = 'Something went wrong.') => {
    if (error instanceof ApiError) {
      toast.error(error.detail ?? error.message ?? fallback);
    } else if (error instanceof Error) {
      toast.error(error.message);
    } else {
      toast.error(fallback);
    }
  },
};
