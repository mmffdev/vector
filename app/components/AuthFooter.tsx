export function AuthFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="auth-page__footer">
      © {year} MMFFDev. All rights reserved.
    </footer>
  );
}
