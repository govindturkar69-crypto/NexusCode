import { createContext } from "react";

// { user, signIn(token), signOut() } — provided by AuthProvider
export const AuthContext = createContext(null);
