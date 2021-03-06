import { ObjectId } from "mongodb";
import { authorize } from "./../../../lib/utils/index";
import { IResolvers } from "apollo-server-express";
import { Request } from "express";
import {
  Database,
  Listing,
  Booking,
  BookingsIndexYear,
  BookingsIndex,
} from "../../../lib/types";
import { CreateBookingArgs } from "./types";
import { Stripe } from "../../../lib/api";
const resolveBookingsIndex = (
  bookingsIndex: BookingsIndex,
  checkInDate: string,
  checkOutDate: string
): BookingsIndex => {
  let dateCursor = new Date(checkInDate);
  let checkOut = new Date(checkOutDate);
  const newBookingsIndex: BookingsIndex = { ...bookingsIndex };

  while (dateCursor <= checkOut) {
    const y = dateCursor.getUTCFullYear();
    const m = dateCursor.getUTCMonth();

    const d = dateCursor.getUTCDate();

    if (!newBookingsIndex[y]) {
      newBookingsIndex[y] = {};
    }
    if (!newBookingsIndex[y][m]) {
      newBookingsIndex[y][m] = {};
    }
    if (!newBookingsIndex[y][m][d]) {
      newBookingsIndex[y][m][d] = true;
    } else {
      throw new Error(
        "please select some other date as its already been booked"
      );
    }
  }

  return newBookingsIndex;
};
export const bookingResolvers: IResolvers = {
  Mutation: {
    createBooking: async (
      _root: undefined,
      { input }: CreateBookingArgs,
      { db, req }: { db: Database; req: Request }
    ): Promise<Booking> => {
      try {
        const { id, source, checkIn, checkOut } = input;
        const viewer = await authorize(db, req);
        if (!viewer) {
          throw new Error("viewer cant be found");
        }
        const listing = await db.listings.findOne({ _id: new ObjectId(id) });
        if (!listing) {
          throw new Error("listings cant be found");
        }
        if (listing.host === viewer._id) {
          throw new Error("listings cant be booked by owner");
        }
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);

        if (checkOutDate < checkInDate) {
          throw new Error("checkout date cant be before checkin date");
        }
        const bookingsIndex = resolveBookingsIndex(
          listing.bookingsIndex,
          checkIn,
          checkOut
        );
        const totalPrice =
          listing.price *
          ((checkOutDate.getTime() - checkInDate.getTime()) / 86400000 + 1);

        const host = await db.users.findOne({ _id: listing.host });
        if (!host || !host.walletId) {
          throw new Error("host isnt connected with stripe");
        }
        await Stripe.charge(totalPrice, source, host.walletId);

        const insertRes = await db.bookings.insertOne({
          _id: new ObjectId(),
          listing: listing._id,
          tenant: viewer._id,
          checkIn,
          checkOut,
        });

        const insertedBooking: Booking = insertRes.ops[0];
        await db.users.updateOne(
          { _id: host._id },
          { $inc: { income: totalPrice } }
        );
        await db.users.updateOne(
          { _id: viewer._id },
          { $push: { bookings: insertedBooking._id } }
        );
        await db.listings.updateOne(
          { _id: listing._id },
          { $set: { bookingsIndex }, $push: { bookings: insertedBooking._id } }
        );
        return insertedBooking;
      } catch (e) {
        throw new Error("please try again later to create a booking");
      }
    },
  },
  Booking: {
    id: (booking: Booking): string => {
      return booking._id.toString();
    },
    listing: (
      booking: Booking,
      _args: {},
      { db }: { db: Database }
    ): Promise<Listing | null> => {
      return db.listings.findOne({ _id: booking.listing });
    },
    tenant: (booking: Booking, _args: {}, { db }: { db: Database }) => {
      return db.users.findOne({ _id: booking.tenant });
    },
  },
};
