import { Redirect } from "expo-router";

/** Ruta antigua: el panel Admin empieza por Usuarios. */
export default function AdminSummaryRoute() {
  return <Redirect href="/admin/users" />;
}
