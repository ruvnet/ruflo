#ifndef UFUNCS_PROTO_H
#define UFUNCS_PROTO_H 1
#include "_cosine.h"
npy_double cosine_cdf(npy_double);
npy_double cosine_invcdf(npy_double);
#include "xsf_wrappers.h"
npy_double cephes_igam_fac(npy_double, npy_double);
npy_double xsf_kolmogc(npy_double);
npy_double xsf_kolmogci(npy_double);
npy_double xsf_kolmogp(npy_double);
npy_double cephes_lanczos_sum_expg_scaled(npy_double);
npy_double cephes_lgam1p(npy_double);
npy_double cephes_smirnovc_wrap(npy_intp, npy_double);
npy_double cephes_smirnovci_wrap(npy_intp, npy_double);
npy_double cephes_smirnovp_wrap(npy_intp, npy_double);
npy_double cephes__struve_asymp_large_z(npy_double, npy_double, npy_intp, npy_double *);
npy_double cephes__struve_bessel_series(npy_double, npy_double, npy_intp, npy_double *);
npy_double cephes__struve_power_series(npy_double, npy_double, npy_intp, npy_double *);
npy_double cephes_bdtr_wrap(npy_double, npy_intp, npy_double);
npy_double cephes_bdtrc_wrap(npy_double, npy_intp, npy_double);
npy_double cephes_bdtri_wrap(npy_double, npy_intp, npy_double);
npy_double xsf_chdtr(npy_double, npy_double);
npy_double xsf_chdtrc(npy_double, npy_double);
npy_double xsf_chdtri(npy_double, npy_double);
npy_double cephes_erfcinv(npy_double);
npy_double cephes_expn_wrap(npy_intp, npy_double);
npy_double xsf_fdtr(npy_double, npy_double, npy_double);
npy_double xsf_fdtrc(npy_double, npy_double, npy_double);
npy_double xsf_fdtri(npy_double, npy_double, npy_double);
npy_double xsf_gdtr(npy_double, npy_double, npy_double);
npy_double xsf_gdtrc(npy_double, npy_double, npy_double);
npy_double xsf_gdtrib(npy_double, npy_double, npy_double);
npy_cdouble chyp1f1_wrap(npy_double, npy_double, npy_cdouble);
npy_double special_cyl_bessel_k_int(npy_intp, npy_double);
npy_double xsf_kolmogi(npy_double);
npy_double xsf_kolmogorov(npy_double);
npy_double pmv_wrap(npy_double, npy_double, npy_double);
npy_double cephes_nbdtr_wrap(npy_intp, npy_intp, npy_double);
npy_double cephes_nbdtrc_wrap(npy_intp, npy_intp, npy_double);
npy_double cephes_nbdtri_wrap(npy_intp, npy_intp, npy_double);
npy_double xsf_ndtri(npy_double);
npy_double xsf_owens_t(npy_double, npy_double);
npy_double xsf_pdtr(npy_double, npy_double);
npy_double xsf_pdtrc(npy_double, npy_double);
npy_double cephes_pdtri_wrap(npy_intp, npy_double);
npy_double cephes_poch(npy_double, npy_double);
npy_double cephes_round(npy_double);
npy_int xsf_cshichi(npy_cdouble, npy_cdouble *, npy_cdouble *);
npy_int xsf_shichi(npy_double, npy_double *, npy_double *);
npy_int xsf_csici(npy_cdouble, npy_cdouble *, npy_cdouble *);
npy_int xsf_sici(npy_double, npy_double *, npy_double *);
npy_double cephes_smirnov_wrap(npy_intp, npy_double);
npy_double cephes_smirnovi_wrap(npy_intp, npy_double);
npy_double cephes_spence(npy_double);
npy_double xsf_tukeylambdacdf(npy_double, npy_double);
npy_double cephes_yn_wrap(npy_intp, npy_double);
#endif
