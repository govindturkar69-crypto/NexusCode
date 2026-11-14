import { lazy } from "react";
import { Navigate } from "react-router-dom";
import { hasValidToken } from "../api/client";
import PublicHeader from "./shell/PublicHeader";

// Its own chunk: signed-in users never download the landing page
const Landing = lazy(() => import("../pages/Landing"));

// "/": signed-in users go to their projects; everyone else sees the landing page
function HomeRoute() {
  if (hasValidToken()) return <Navigate to="/projects" replace />;
  return (
    <>
      <PublicHeader showAuthLinks />
      <Landing />
    </>
  );
}

export default HomeRoute;
