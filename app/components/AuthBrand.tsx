import Image from "next/image";

export function AuthBrand() {
  return (
    <div className="auth-card__brand" aria-hidden="true">
      <div className="auth-card__logo-wrap">
        <Image
          src="/logo-vector.png"
          alt=""
          width={190}
          height={190}
          className="auth-card__logo"
          priority
        />
        <span className="auth-card__plus" />
      </div>
      <div className="auth-card__wordmark">
        <span className="auth-card__wordmark-name">+++ VECTOR</span>
        <span className="auth-card__wordmark-version">v1.01</span>
      </div>
    </div>
  );
}
