import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { AUTH } from './auth-config';
import * as auth0 from 'auth0-js';
import { Subscription } from 'rxjs/Subscription';
import { Observable } from 'rxjs/Observable';
import { AngularFireAuth } from 'angularfire2/auth';
import * as firebase from 'firebase/app';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';

@Injectable()
export class AuthService {
  // Create Auth0 web auth instance
  private _auth0 = new auth0.WebAuth({
    clientID: AUTH.clientId,
    domain: AUTH.clientDomain,
    responseType: 'token id_token',
    redirectUri: AUTH.redirect,
    audience: AUTH.audience,
    scope: AUTH.scope
  });
  userProfile: any;
  // Create a stream of logged in status to communicate throughout app
  loggedIn: boolean;
  loggedIn$ = new BehaviorSubject<boolean>(this.loggedIn);
  // Create a stream of Firebase authentication status to communicate throughout app
  loggedInFirebase: boolean;
  loggedInFirebase$ = new BehaviorSubject<boolean>(this.loggedInFirebase);
  // Subscribe to the Firebase token stream
  firebaseSub: Subscription;

  constructor(
    private router: Router,
    private afAuth: AngularFireAuth,
    private http: HttpClient) {
    // If authenticated, set local profile property and get new Firebase token.
    // If not authenticated but there are still items n localStorage, log out.
    const lsProfile = localStorage.getItem('profile');
    const lsToken = localStorage.getItem('access_token');

    if (this.tokenValid) {
      this.userProfile = JSON.parse(lsProfile);
      this.setLoggedIn(true);
      this._getFirebaseToken(lsToken);
    } else if (!this.tokenValid && lsProfile) {
      this.logout();
    }
  }

  setLoggedIn(value: boolean) {
    // Update login status subject
    this.loggedIn$.next(value);
    this.loggedIn = value;
  }

  setLoggedInFirebase(value: boolean) {
    // Update Firebase login status subject
    this.loggedInFirebase$.next(value);
    this.loggedInFirebase = value;
  }

  login(redirect?: string) {
    // Set redirect after login
    const _redirect = redirect ? redirect : this.router.url;
    localStorage.setItem('authRedirect', _redirect);
    // Auth0 authorize request
    this._auth0.authorize();
  }

  handleAuth() {
    // When Auth0 hash parsed, get profile
    this._auth0.parseHash((err, authResult) => {
      if (authResult && authResult.accessToken && authResult.idToken) {
        window.location.hash = '';
        this.setLoggedIn(null);
        this._getProfile(authResult);
      } else if (err) {
        this._clearRedirect();
        this.router.navigate(['/']);
        this.setLoggedIn(false);
        console.error(`Error authenticating: ${err.error}`);
      }
    });
  }

  private _getProfile(authResult) {
    // Use access token to retrieve user's profile and set session
    this._auth0.client.userInfo(authResult.accessToken, (err, profile) => {
      if (profile) {
        this._setSession(authResult, profile);
        this.router.navigate([localStorage.getItem('authRedirect')]);
        this._clearRedirect();
      } else if (err) {
        console.warn(`Error retrieving profile: ${err.error}`);
      }
    });
  }

  private _setSession(authResult, profile) {
    // Set tokens and expiration in localStorage
    const expiresAt = JSON.stringify((authResult.expiresIn * 1000) + Date.now());
    localStorage.setItem('access_token', authResult.accessToken);
    localStorage.setItem('id_token', authResult.idToken);
    localStorage.setItem('expires_at', expiresAt);
    // Set profile information
    localStorage.setItem('profile', JSON.stringify(profile));
    this.userProfile = profile;
    // Session set; set loggedIn
    this.setLoggedIn(true);
    // Get Firebase token
    this._getFirebaseToken(authResult.accessToken);
  }

  private _getFirebaseToken(accessToken) {
    const getToken$ = () => {
      return this.http
        .get(`http://localhost:1337/auth/firebase`, {
          headers: new HttpHeaders().set('Authorization', `Bearer ${accessToken}`)
        });
    };
    this.firebaseSub = getToken$().subscribe(
      res => this._firebaseAuth(res),
      err => console.error(`An error occurred fetching Firebase token: ${err}`)
    );
  }

  private _firebaseAuth(tokenObj) {
    this.afAuth.auth.signInWithCustomToken(tokenObj.firebaseToken)
      .then(res => {
        // Emit loggedInFirebase$ subject with true value
        this.setLoggedInFirebase(true);
        this.firebaseSub.unsubscribe();
        console.log('Successfully authenticated with Firebase!');
      })
      .catch(err => {
        const errorCode = err.code;
        const errorMessage = err.message;
        console.error(`${errorCode} Could not log into Firebase: ${errorMessage}`);
      });
  }

  private _clearRedirect() {
    // Remove redirect from localStorage
    localStorage.removeItem('authRedirect');
  }

  logout(noRedirect?: boolean) {
    // Ensure all auth items removed from localStorage
    localStorage.removeItem('access_token');
    localStorage.removeItem('profile');
    localStorage.removeItem('expires_at');
    this._clearRedirect();
    // Reset local properties, update loggedIn$ stream
    this.userProfile = undefined;
    this.setLoggedIn(false);
    // Sign out of Firebase
    this.setLoggedInFirebase(false);
    this.afAuth.auth.signOut();
    // Return to homepage
    if (noRedirect !== true) {
      this.router.navigate(['/']);
    }
  }

  get tokenValid(): boolean {
    // Check if current time is past access token's expiration
    const expiresAt = JSON.parse(localStorage.getItem('expires_at'));
    return Date.now() < expiresAt;
  }

}